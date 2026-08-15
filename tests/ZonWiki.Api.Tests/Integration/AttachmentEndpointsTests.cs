using System.Net;
using System.Net.Http.Headers;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 附件端點整合測試（真 HTTP＋真 PostgreSQL＋真驗證管線）。
/// 涵蓋：上傳成功（WebP 重編碼/GIF 原樣/EXIF 轉正/超尺寸縮圖）、驗證拒收
/// （超大/假圖/白名單外/0 byte/解壓炸彈/配額）、取回（快取標頭/nosniff）、
/// 使用者隔離、軟刪除後 404、未登入 401、限流 429。
/// 測試計畫與對抗式審查結論見 scratchpad attachment-feature-plan.md 與 docs/DECISIONS.md 2026-07-08。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class AttachmentEndpointsTests(ZonWikiApiFactory factory)
{
    /// <summary>
    /// 組出上傳用的 multipart 表單內容。
    /// </summary>
    /// <param name="bytes">檔案位元組。</param>
    /// <param name="fileName">檔名。</param>
    /// <param name="contentType">client 宣稱的內容型別（伺服器不應信任）。</param>
    /// <returns>multipart 表單內容。</returns>
    private static MultipartFormDataContent BuildUploadForm(
        byte[] bytes, string fileName = "test.png", string contentType = "image/png")
    {
        var fileContent = new ByteArrayContent(bytes);
        fileContent.Headers.ContentType = MediaTypeHeaderValue.Parse(contentType);
        return new MultipartFormDataContent { { fileContent, "file", fileName } };
    }

    /// <summary>
    /// 上傳一張圖並回傳（回應, 解析出的附件 Id 與 Url）。斷言由呼叫端做。
    /// </summary>
    private static async Task<(HttpResponseMessage Response, Guid Id, string Url)> UploadAsync(
        HttpClient client, byte[] bytes, string fileName = "test.png", string contentType = "image/png")
    {
        var response = await client.PostAsync("/api/attachments", BuildUploadForm(bytes, fileName, contentType));
        if (!response.IsSuccessStatusCode)
        {
            return (response, Guid.Empty, string.Empty);
        }
        var json = await response.ReadJsonAsync();
        var id = Guid.Parse(json["data"]!["id"]!.GetValue<string>());
        var url = json["data"]!["url"]!.GetValue<string>();
        return (response, id, url);
    }

    // ── 上傳成功路徑 ─────────────────────────────────────────────────────────

    [Fact]
    public async Task PostAttachment_ValidPng_ReturnsUrlAndStoresWebpOnDisk()
    {
        // Arrange
        var (userId, token) = await factory.SeedUserWithTokenAsync($"att-png-{Guid.NewGuid():N}@test.local");
        var client = factory.CreateClientWithToken(token);

        // Act
        var (response, id, url) = await UploadAsync(client, TestImageFactory.CreatePng(64, 48));

        // Assert：回應
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        url.Should().Be($"/api/attachments/{id}");

        // Assert：DB 中繼資料（擁有者、型別、尺寸）
        var (scope, db) = factory.CreateDbScope();
        using (scope)
        {
            var row = await db.NoteAttachment.IgnoreQueryFilters().AsNoTracking()
                .FirstOrDefaultAsync(a => a.Id == id);
            row.Should().NotBeNull();
            row!.UserId.Should().Be(userId);
            row.ValidFlag.Should().BeTrue();
            row.ContentType.Should().Be("image/webp");
            row.Width.Should().Be(64);
            row.Height.Should().Be(48);

            // Assert：磁碟檔案存在且為 WebP
            var fullPath = Path.Combine(factory.AttachmentRootPath, row.FilePath);
            File.Exists(fullPath).Should().BeTrue("附件檔案必須實際落地");
            var (format, w, h) = TestImageFactory.Inspect(await File.ReadAllBytesAsync(fullPath));
            format.Should().Be("Webp");
            w.Should().Be(64);
            h.Should().Be(48);
        }
    }

    [Fact]
    public async Task GetAttachment_Owner_ReturnsWebpWithImmutableCacheAndNosniff()
    {
        // Arrange
        var (_, token) = await factory.SeedUserWithTokenAsync($"att-get-{Guid.NewGuid():N}@test.local");
        var client = factory.CreateClientWithToken(token);
        var (_, id, url) = await UploadAsync(client, TestImageFactory.CreatePng());

        // Act
        var response = await client.GetAsync(url);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Content.Headers.ContentType!.MediaType.Should().Be("image/webp");
        response.Headers.CacheControl!.ToString().Should().Contain("max-age=31536000")
            .And.Contain("immutable").And.Contain("private");
        response.Headers.TryGetValues("X-Content-Type-Options", out var nosniff).Should().BeTrue();
        nosniff!.Should().ContainSingle().Which.Should().Be("nosniff");

        var bytes = await response.Content.ReadAsByteArrayAsync();
        TestImageFactory.Inspect(bytes).FormatName.Should().Be("Webp", "回傳的位元組必須是可解碼的 WebP");
        _ = id;
    }

    [Fact]
    public async Task PostAttachment_Gif_IsStoredAsIsPreservingBytes()
    {
        // Arrange
        var (_, token) = await factory.SeedUserWithTokenAsync($"att-gif-{Guid.NewGuid():N}@test.local");
        var client = factory.CreateClientWithToken(token);
        var gifBytes = TestImageFactory.CreateGif();

        // Act
        var (response, _, url) = await UploadAsync(client, gifBytes, "anim.gif", "image/gif");

        // Assert：GIF 原樣保存（位元組一致、型別 image/gif）
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var get = await client.GetAsync(url);
        get.Content.Headers.ContentType!.MediaType.Should().Be("image/gif");
        (await get.Content.ReadAsByteArrayAsync()).Should().Equal(gifBytes, "GIF 不重編碼（保留動畫）");
    }

    [Fact]
    public async Task PostAttachment_JpegWithExifOrientation6_IsAutoOriented()
    {
        // Arrange：EXIF Orientation=6（順時針 90°）→ 轉正後寬高應對調
        var (_, token) = await factory.SeedUserWithTokenAsync($"att-exif-{Guid.NewGuid():N}@test.local");
        var client = factory.CreateClientWithToken(token);

        // Act
        var (response, _, url) = await UploadAsync(
            client, TestImageFactory.CreateJpegWithExifOrientation6(300, 200), "photo.jpg", "image/jpeg");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var bytes = await (await client.GetAsync(url)).Content.ReadAsByteArrayAsync();
        var (_, w, h) = TestImageFactory.Inspect(bytes);
        (w, h).Should().Be((200, 300), "EXIF 轉正後寬高必須對調，否則手機照片會永久橫躺");
    }

    [Fact]
    public async Task PostAttachment_HugeDimensions_IsResizedToMaxDimension()
    {
        // Arrange：3000×1500 超過預設最長邊 2560 → 等比縮成 2560×1280
        var (_, token) = await factory.SeedUserWithTokenAsync($"att-resize-{Guid.NewGuid():N}@test.local");
        var client = factory.CreateClientWithToken(token);

        // Act
        var (response, _, url) = await UploadAsync(client, TestImageFactory.CreatePng(3000, 1500));

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var bytes = await (await client.GetAsync(url)).Content.ReadAsByteArrayAsync();
        var (_, w, h) = TestImageFactory.Inspect(bytes);
        (w, h).Should().Be((2560, 1280), "超過上限的圖必須等比縮小到最長邊 2560");
    }

    [Fact]
    public async Task PostAttachment_ClientLiesAboutContentType_ServerDetectsRealFormat()
    {
        // Arrange：PNG 位元組、client 宣稱 image/gif —— 不信任 client MIME
        var (_, token) = await factory.SeedUserWithTokenAsync($"att-lie-{Guid.NewGuid():N}@test.local");
        var client = factory.CreateClientWithToken(token);

        // Act
        var (response, id, _) = await UploadAsync(client, TestImageFactory.CreatePng(), "fake.gif", "image/gif");

        // Assert：以伺服器實際偵測（PNG）為準 → 重編碼 WebP，而非依宣稱存成 gif
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var (scope, db) = factory.CreateDbScope();
        using (scope)
        {
            var row = await db.NoteAttachment.IgnoreQueryFilters().AsNoTracking().FirstAsync(a => a.Id == id);
            row.ContentType.Should().Be("image/webp", "格式判定必須以伺服器解碼結果為準，不信任 client 宣稱");
        }
    }

    // ── 驗證拒收路徑 ─────────────────────────────────────────────────────────

    [Fact]
    public async Task PostAttachment_OverSizeLimit_Returns400AndLeavesNoResidue()
    {
        // Arrange：約 19MB 的 BMP（> 預設 10MB）
        var (userId, token) = await factory.SeedUserWithTokenAsync($"att-big-{Guid.NewGuid():N}@test.local");
        var client = factory.CreateClientWithToken(token);

        // Act
        var response = await client.PostAsync(
            "/api/attachments", BuildUploadForm(TestImageFactory.CreateOversizedBmp(), "big.bmp", "image/bmp"));

        // Assert：400＋無 DB 殘留
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var json = await response.ReadJsonAsync();
        json["error"]!.GetValue<string>().Should().Contain("過大");
        var (scope, db) = factory.CreateDbScope();
        using (scope)
        {
            (await db.NoteAttachment.IgnoreQueryFilters().CountAsync(a => a.UserId == userId))
                .Should().Be(0, "拒收的上傳不得留下任何 DB 列");
        }
    }

    [Fact]
    public async Task PostAttachment_TextPretendingToBeImage_Returns400()
    {
        // Arrange：純文字位元組、宣稱 image/png
        var (_, token) = await factory.SeedUserWithTokenAsync($"att-fake-{Guid.NewGuid():N}@test.local");
        var client = factory.CreateClientWithToken(token);
        var textBytes = System.Text.Encoding.UTF8.GetBytes("這不是圖片，只是文字冒充的。");

        // Act
        var response = await client.PostAsync("/api/attachments", BuildUploadForm(textBytes));

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task PostAttachment_TiffOutsideWhitelist_Returns400()
    {
        // Arrange：合法 TIFF（ImageSharp 解得開）但不在白名單
        var (_, token) = await factory.SeedUserWithTokenAsync($"att-tiff-{Guid.NewGuid():N}@test.local");
        var client = factory.CreateClientWithToken(token);

        // Act
        var response = await client.PostAsync(
            "/api/attachments", BuildUploadForm(TestImageFactory.CreateTiff(), "scan.tiff", "image/tiff"));

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.ReadJsonAsync())["error"]!.GetValue<string>().Should().Contain("不支援");
    }

    [Fact]
    public async Task PostAttachment_ZeroByteFile_Returns400()
    {
        var (_, token) = await factory.SeedUserWithTokenAsync($"att-zero-{Guid.NewGuid():N}@test.local");
        var client = factory.CreateClientWithToken(token);

        var response = await client.PostAsync("/api/attachments", BuildUploadForm([]));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task PostAttachment_NoFilePart_Returns400()
    {
        var (_, token) = await factory.SeedUserWithTokenAsync($"att-nofile-{Guid.NewGuid():N}@test.local");
        var client = factory.CreateClientWithToken(token);

        // multipart 表單存在、但沒有名為 file 的檔案欄位
        var form = new MultipartFormDataContent { { new StringContent("hello"), "other" } };
        var response = await client.PostAsync("/api/attachments", form);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task PostAttachment_DecompressionBomb_Returns400BeforeFullDecode()
    {
        // Arrange：7000×7000=49MP 的高壓縮純色 PNG（檔案小、解碼大）→ 解碼前就要擋
        var (_, token) = await factory.SeedUserWithTokenAsync($"att-bomb-{Guid.NewGuid():N}@test.local");
        var client = factory.CreateClientWithToken(token);

        // Act
        var response = await client.PostAsync(
            "/api/attachments", BuildUploadForm(TestImageFactory.CreateDecompressionBombPng()));

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.ReadJsonAsync())["error"]!.GetValue<string>().Should().Contain("像素過多");
    }

    [Fact]
    public async Task PostAttachment_QuotaExceeded_Returns400()
    {
        // Arrange：直接種一列「接近 500MB 配額」的既有附件，再上傳真實小圖 → 超配額
        var (userId, token) = await factory.SeedUserWithTokenAsync($"att-quota-{Guid.NewGuid():N}@test.local");
        var client = factory.CreateClientWithToken(token);
        var (scope, db) = factory.CreateDbScope();
        using (scope)
        {
            db.NoteAttachment.Add(new Domain.Entities.NoteAttachment
            {
                UserId = userId,
                FileName = "quota-filler.webp",
                FilePath = $"{userId:N}/filler.webp",
                ContentType = "image/webp",
                // 距離上限只剩 1 byte：任何成功落地的圖（WebP 至少數十 bytes）都必超額。
                // （配額以「落地後大小」計——純色小 PNG 壓成 WebP 可能不到 100 bytes，餘裕不能留太大。）
                FileSizeBytes = 500L * 1024 * 1024 - 1,
                Width = 1,
                Height = 1,
                CreatedUser = "test",
                UpdatedUser = "test",
            });
            await db.SaveChangesAsync();
        }

        // Act
        var response = await client.PostAsync("/api/attachments", BuildUploadForm(TestImageFactory.CreatePng()));

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.ReadJsonAsync())["error"]!.GetValue<string>().Should().Contain("總容量");
    }

    // ── 認證 / 隔離 / 生命週期 ────────────────────────────────────────────────

    [Fact]
    public async Task Attachment_Unauthenticated_Returns401()
    {
        var client = factory.CreateClient(); // 不帶任何憑證

        var post = await client.PostAsync("/api/attachments", BuildUploadForm(TestImageFactory.CreatePng()));
        var get = await client.GetAsync($"/api/attachments/{Guid.NewGuid()}");

        post.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        get.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetAttachment_OtherUsersAttachment_Returns404()
    {
        // Arrange：A 上傳、B 來抓
        var (_, tokenA) = await factory.SeedUserWithTokenAsync($"att-isoA-{Guid.NewGuid():N}@test.local");
        var (_, tokenB) = await factory.SeedUserWithTokenAsync($"att-isoB-{Guid.NewGuid():N}@test.local");
        var clientA = factory.CreateClientWithToken(tokenA);
        var clientB = factory.CreateClientWithToken(tokenB);
        var (_, _, url) = await UploadAsync(clientA, TestImageFactory.CreatePng());

        // Act & Assert：使用者隔離 → 他人一律 404（不洩漏存在性）
        (await clientB.GetAsync(url)).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await clientA.GetAsync(url)).StatusCode.Should().Be(HttpStatusCode.OK, "擁有者自己仍可取回");
    }

    [Fact]
    public async Task GetAttachment_SoftDeleted_Returns404()
    {
        // Arrange：上傳後直接把列軟刪除
        var (_, token) = await factory.SeedUserWithTokenAsync($"att-del-{Guid.NewGuid():N}@test.local");
        var client = factory.CreateClientWithToken(token);
        var (_, id, url) = await UploadAsync(client, TestImageFactory.CreatePng());
        var (scope, db) = factory.CreateDbScope();
        using (scope)
        {
            var row = await db.NoteAttachment.IgnoreQueryFilters().FirstAsync(a => a.Id == id);
            row.ValidFlag = false;
            row.DeletedDateTime = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }

        // Act & Assert
        (await client.GetAsync(url)).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task GetAttachment_UnknownId_Returns404()
    {
        var (_, token) = await factory.SeedUserWithTokenAsync($"att-404-{Guid.NewGuid():N}@test.local");
        var client = factory.CreateClientWithToken(token);

        (await client.GetAsync($"/api/attachments/{Guid.NewGuid()}"))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task GetAttachment_MalformedId_Returns404()
    {
        var (_, token) = await factory.SeedUserWithTokenAsync($"att-badid-{Guid.NewGuid():N}@test.local");
        var client = factory.CreateClientWithToken(token);

        // 路由約束 {id:guid} 對非 GUID 直接 404（固化此行為）
        (await client.GetAsync("/api/attachments/not-a-guid"))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // ── 限流 ─────────────────────────────────────────────────────────────────

    [Fact]
    public async Task PostAttachment_Burst_TriggersRateLimit429()
    {
        // Arrange：限流以 UserId 分區（TokenBucket 容量 20）→ 用專屬使用者不污染其他測試
        var (_, token) = await factory.SeedUserWithTokenAsync($"att-rate-{Guid.NewGuid():N}@test.local");
        var client = factory.CreateClientWithToken(token);
        var png = TestImageFactory.CreatePng(8, 8);

        // Act：連打 25 發，收集狀態碼
        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 25; i++)
        {
            var response = await client.PostAsync("/api/attachments", BuildUploadForm(png));
            statuses.Add(response.StatusCode);
        }

        // Assert：超過桶容量後必出現 429
        statuses.Should().Contain(HttpStatusCode.TooManyRequests, "連續爆量上傳必須被限流");
        statuses.Take(10).Should().OnlyContain(s => s == HttpStatusCode.OK, "前段正常量不應被誤傷");
    }
}
