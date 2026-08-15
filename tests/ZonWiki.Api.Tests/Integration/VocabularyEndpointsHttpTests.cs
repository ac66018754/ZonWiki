using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Xunit;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 單字庫手動 CRUD＋清單端點的「真 HTTP」整合測試（PAT 驗證）：
/// 建立／正規化／唯一去重／驗證／state 篩選／search／分頁／更新／軟刪除／復活／跨使用者隔離／未驗證 401。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class VocabularyEndpointsHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    public VocabularyEndpointsHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    private async Task<(Guid UserId, HttpClient Client)> NewUserClientAsync()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"vocab-{Guid.NewGuid():N}@example.com");
        return (userId, _factory.CreateClientWithToken(token));
    }

    private static async Task<Guid> CreateVocabularyAsync(HttpClient client, object body)
    {
        var response = await client.PostAsJsonAsync("/api/vocabulary", body);
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var json = await response.ReadJsonAsync();
        return Guid.Parse(json["data"]!["id"]!.GetValue<string>());
    }

    // H1
    [Fact]
    public async Task PostVocabulary_合法_回201並落庫()
    {
        var (_, client) = await NewUserClientAsync();

        var response = await client.PostAsJsonAsync("/api/vocabulary", new { word = "hello" });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var json = await response.ReadJsonAsync();
        json["data"]!["word"]!.GetValue<string>().Should().Be("hello");
        json["data"]!["state"]!.GetValue<string>().Should().Be("new");
        json["data"]!["reps"]!.GetValue<int>().Should().Be(0);
        json["data"]!["schedulePreview"]!["good"]!["intervalDays"]!.GetValue<double>().Should().Be(1);
    }

    // H2
    [Fact]
    public async Task PostVocabulary_大寫詞_正規化為小寫()
    {
        var (_, client) = await NewUserClientAsync();

        var response = await client.PostAsJsonAsync("/api/vocabulary", new { word = "  Hello  " });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var json = await response.ReadJsonAsync();
        json["data"]!["word"]!.GetValue<string>().Should().Be("hello");
    }

    // H3
    [Fact]
    public async Task PostVocabulary_同字重送_不重複建立()
    {
        var (userId, client) = await NewUserClientAsync();

        var first = await client.PostAsJsonAsync("/api/vocabulary", new { word = "apple" });
        first.StatusCode.Should().Be(HttpStatusCode.Created);
        var firstId = (await first.ReadJsonAsync())["data"]!["id"]!.GetValue<string>();

        var second = await client.PostAsJsonAsync("/api/vocabulary", new { word = "APPLE" });
        second.StatusCode.Should().Be(HttpStatusCode.OK, "既有字重送應回 200（非新建）");
        var secondId = (await second.ReadJsonAsync())["data"]!["id"]!.GetValue<string>();

        secondId.Should().Be(firstId);

        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            (await db.VocabularyWord.IgnoreQueryFilters()
                .CountAsync(v => v.UserId == userId && v.Word == "apple")).Should().Be(1);
        }
    }

    // H4
    [Fact]
    public async Task PostVocabulary_空字_回400()
    {
        var (_, client) = await NewUserClientAsync();

        var response = await client.PostAsJsonAsync("/api/vocabulary", new { word = "   " });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    // H5
    [Fact]
    public async Task PostVocabulary_word超長_回400()
    {
        var (_, client) = await NewUserClientAsync();

        var response = await client.PostAsJsonAsync("/api/vocabulary", new { word = new string('a', 201) });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    // H6
    [Fact]
    public async Task PostVocabulary_sourceNoteId非本人_回400()
    {
        var (_, clientA) = await NewUserClientAsync();
        var (userIdB, _) = await NewUserClientAsync();

        // 直接為 B 種一筆筆記，取其 Id。
        Guid noteIdB;
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var now = DateTime.UtcNow;
            var note = new Note
            {
                UserId = userIdB,
                Title = "B 的筆記",
                Slug = $"b-note-{Guid.NewGuid():N}",
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = userIdB.ToString(),
                UpdatedUser = userIdB.ToString(),
            };
            db.Note.Add(note);
            await db.SaveChangesAsync();
            noteIdB = note.Id;
        }

        var response = await clientA.PostAsJsonAsync("/api/vocabulary", new { word = "borrowed", sourceNoteId = noteIdB });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    // H7
    [Fact]
    public async Task GetVocabulary_預設_回本人清單不含軟刪()
    {
        var (_, client) = await NewUserClientAsync();
        var id1 = await CreateVocabularyAsync(client, new { word = "keep" });
        var id2 = await CreateVocabularyAsync(client, new { word = "delete" });

        (await client.DeleteAsync($"/api/vocabulary/{id2}")).StatusCode.Should().Be(HttpStatusCode.NoContent);

        var json = await (await client.GetAsync("/api/vocabulary")).ReadJsonAsync();
        var ids = json["data"]!.AsArray().Select(n => n!["id"]!.GetValue<string>()).ToList();
        ids.Should().Contain(id1.ToString());
        ids.Should().NotContain(id2.ToString());
    }

    // H8
    [Fact]
    public async Task GetVocabulary_state篩選_只回該狀態()
    {
        var (_, client) = await NewUserClientAsync();
        var reviewedId = await CreateVocabularyAsync(client, new { word = "graduated" });
        await CreateVocabularyAsync(client, new { word = "fresh" });

        // 複習一次 good → state 從 new 變 review。
        (await client.PostAsJsonAsync($"/api/vocabulary/{reviewedId}/review", new { rating = "good" }))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        var json = await (await client.GetAsync("/api/vocabulary?state=review")).ReadJsonAsync();
        var words = json["data"]!.AsArray().Select(n => n!["word"]!.GetValue<string>()).ToList();
        words.Should().Contain("graduated");
        words.Should().NotContain("fresh");
    }

    // H9
    [Fact]
    public async Task GetVocabulary_search_命中Word或釋義()
    {
        var (_, client) = await NewUserClientAsync();
        await CreateVocabularyAsync(client, new { word = "serendipity", definitionZh = "意外發現美好事物的能力" });
        await CreateVocabularyAsync(client, new { word = "unrelated" });

        var byWord = await (await client.GetAsync("/api/vocabulary?search=seren")).ReadJsonAsync();
        byWord["data"]!.AsArray().Select(n => n!["word"]!.GetValue<string>())
            .Should().ContainSingle().Which.Should().Be("serendipity");

        var byDef = await (await client.GetAsync("/api/vocabulary?search=意外發現")).ReadJsonAsync();
        byDef["data"]!.AsArray().Select(n => n!["word"]!.GetValue<string>())
            .Should().Contain("serendipity");
    }

    // H10
    [Fact]
    public async Task GetVocabulary_未帶limit_套預設50()
    {
        var (userId, client) = await NewUserClientAsync();

        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var now = DateTime.UtcNow;
            for (var i = 0; i < 55; i++)
            {
                db.VocabularyWord.Add(new VocabularyWord
                {
                    UserId = userId,
                    Word = $"seed{i:D3}",
                    Difficulty = 2.5,
                    Due = now,
                    CreatedUser = userId.ToString(),
                    UpdatedUser = userId.ToString(),
                });
            }

            await db.SaveChangesAsync();
        }

        var json = await (await client.GetAsync("/api/vocabulary")).ReadJsonAsync();

        json["data"]!.AsArray().Should().HaveCount(50, "未帶 limit 應套預設 50");
        json["meta"]!["total"]!.GetValue<int>().Should().Be(55);
    }

    // H11
    [Fact]
    public async Task GetVocabulary_limit與offset_正確分頁()
    {
        var (_, client) = await NewUserClientAsync();
        for (var i = 0; i < 5; i++)
        {
            await CreateVocabularyAsync(client, new { word = $"page{i}" });
        }

        var json = await (await client.GetAsync("/api/vocabulary?limit=2&offset=1")).ReadJsonAsync();

        json["data"]!.AsArray().Should().HaveCount(2);
        json["meta"]!["total"]!.GetValue<int>().Should().Be(5);
    }

    // H12
    [Fact]
    public async Task PutVocabulary_改釋義_成功()
    {
        var (_, client) = await NewUserClientAsync();
        var id = await CreateVocabularyAsync(client, new { word = "edit" });

        var response = await client.PutAsJsonAsync($"/api/vocabulary/{id}",
            new { definitionZh = "編輯", partOfSpeech = "verb" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.ReadJsonAsync();
        json["data"]!["definitionZh"]!.GetValue<string>().Should().Be("編輯");
        json["data"]!["partOfSpeech"]!.GetValue<string>().Should().Be("verb");
        json["data"]!["word"]!.GetValue<string>().Should().Be("edit", "Word 不可改");
    }

    // H13
    [Fact]
    public async Task PutVocabulary_跨使用者_回404()
    {
        var (_, clientA) = await NewUserClientAsync();
        var (_, clientB) = await NewUserClientAsync();
        var idB = await CreateVocabularyAsync(clientB, new { word = "secret" });

        var response = await clientA.PutAsJsonAsync($"/api/vocabulary/{idB}", new { definitionZh = "駭入" });

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // H14
    [Fact]
    public async Task DeleteVocabulary_軟刪_回204且清單消失()
    {
        var (userId, client) = await NewUserClientAsync();
        var id = await CreateVocabularyAsync(client, new { word = "removeme" });

        (await client.DeleteAsync($"/api/vocabulary/{id}")).StatusCode.Should().Be(HttpStatusCode.NoContent);

        var json = await (await client.GetAsync("/api/vocabulary")).ReadJsonAsync();
        json["data"]!.AsArray().Select(n => n!["id"]!.GetValue<string>()).Should().NotContain(id.ToString());

        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var row = await db.VocabularyWord.IgnoreQueryFilters().FirstAsync(v => v.Id == id);
            row.ValidFlag.Should().BeFalse();
            row.DeletedDateTime.Should().NotBeNull();
        }
    }

    // H15
    [Fact]
    public async Task PostVocabulary_復活軟刪列()
    {
        var (userId, client) = await NewUserClientAsync();
        var id = await CreateVocabularyAsync(client, new { word = "phoenix" });
        (await client.DeleteAsync($"/api/vocabulary/{id}")).StatusCode.Should().Be(HttpStatusCode.NoContent);

        var response = await client.PostAsJsonAsync("/api/vocabulary", new { word = "phoenix" });
        response.StatusCode.Should().Be(HttpStatusCode.OK, "復活非新建，回 200");
        var revivedId = (await response.ReadJsonAsync())["data"]!["id"]!.GetValue<string>();
        revivedId.Should().Be(id.ToString());

        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var rows = await db.VocabularyWord.IgnoreQueryFilters()
                .Where(v => v.UserId == userId && v.Word == "phoenix").ToListAsync();
            rows.Should().ContainSingle();
            rows[0].ValidFlag.Should().BeTrue("應復活而非新建");
        }
    }

    // H16
    [Fact]
    public async Task NoToken_寫入端點_回401()
    {
        var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/vocabulary", new { word = "anon" });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // H18（審查 LOW：來源筆記 slug/title 進 DTO，供前端做正確 slug 連結）
    [Fact]
    public async Task PostVocabulary_帶本人來源筆記_DTO回slug與title()
    {
        var (userId, client) = await NewUserClientAsync();

        Guid noteId;
        var slug = $"my-note-{Guid.NewGuid():N}";
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var now = DateTime.UtcNow;
            var note = new Note
            {
                UserId = userId,
                Title = "來源筆記標題",
                Slug = slug,
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
            };
            db.Note.Add(note);
            await db.SaveChangesAsync();
            noteId = note.Id;
        }

        var response = await client.PostAsJsonAsync("/api/vocabulary", new { word = "sourced", sourceNoteId = noteId });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var json = await response.ReadJsonAsync();
        json["data"]!["sourceNoteId"]!.GetValue<string>().Should().Be(noteId.ToString());
        json["data"]!["sourceNoteSlug"]!.GetValue<string>().Should().Be(slug);
        json["data"]!["sourceNoteTitle"]!.GetValue<string>().Should().Be("來源筆記標題");
    }

    // H19（審查 #3：手動 CRUD 無長度驗證 → varchar(128) 超長觸發 22001 → 自觸發 500）
    [Fact]
    public async Task PostVocabulary_phonetic超長_回400()
    {
        var (_, client) = await NewUserClientAsync();

        var response = await client.PostAsJsonAsync("/api/vocabulary",
            new { word = "longphon", phonetic = new string('a', 129) });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    // H20（審查 #3：partOfSpeech varchar(64) 超長）
    [Fact]
    public async Task PostVocabulary_partOfSpeech超長_回400()
    {
        var (_, client) = await NewUserClientAsync();

        var response = await client.PostAsJsonAsync("/api/vocabulary",
            new { word = "longpos", partOfSpeech = new string('a', 65) });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    // H21（審查 #3：無界 text 釋義的應用層上限 2000）
    [Fact]
    public async Task PostVocabulary_definitionZh超長_回400()
    {
        var (_, client) = await NewUserClientAsync();

        var response = await client.PostAsJsonAsync("/api/vocabulary",
            new { word = "longdef", definitionZh = new string('字', 2001) });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    // H22（審查 #3：更新路徑同樣守門）
    [Fact]
    public async Task PutVocabulary_phonetic超長_回400()
    {
        var (_, client) = await NewUserClientAsync();
        var id = await CreateVocabularyAsync(client, new { word = "putlong" });

        var response = await client.PutAsJsonAsync($"/api/vocabulary/{id}",
            new { phonetic = new string('a', 129) });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    // H23（審查 #3：合法上限值仍可存——128 音標不誤擋）
    [Fact]
    public async Task PostVocabulary_phonetic剛好128_可存()
    {
        var (_, client) = await NewUserClientAsync();

        var response = await client.PostAsJsonAsync("/api/vocabulary",
            new { word = "edge128", phonetic = new string('a', 128) });

        response.StatusCode.Should().Be(HttpStatusCode.Created, "剛好等於上限不應被誤擋");
    }

    // H17
    [Fact]
    public async Task CrossUser_讀他人清單_看不到()
    {
        var (_, clientA) = await NewUserClientAsync();
        var (_, clientB) = await NewUserClientAsync();
        var idB = await CreateVocabularyAsync(clientB, new { word = "private" });

        var json = await (await clientA.GetAsync("/api/vocabulary")).ReadJsonAsync();

        json["data"]!.AsArray().Select(n => n!["id"]!.GetValue<string>()).Should().NotContain(idB.ToString());
    }
}
