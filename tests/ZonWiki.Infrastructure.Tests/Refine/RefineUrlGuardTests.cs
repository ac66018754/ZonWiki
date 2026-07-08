using System.Net;
using FluentAssertions;
using Xunit;
using ZonWiki.Infrastructure.Refine;

namespace ZonWiki.Infrastructure.Tests.Refine;

/// <summary>
/// <see cref="RefineUrlGuard"/> 的 SSRF 防護單元測試（對應審查 finding #35）。
///
/// 重點在於把「安全關鍵」的純函式行為固化成可重複執行的自動化測試，避免日後任何改動
/// 悄悄退回不安全狀態（例如漏擋 IPv4-mapped IPv6、私有網段或雲端中繼資料端點）而無人察覺。
///
/// 這些案例刻意只用「IP 字面值」或「會在 DNS 前短路的主機名稱」，故完全不需要真實網路 /
/// DNS 即可決定性地驗證行為（DNS 相依的分支不在此檔測試範圍）。
/// </summary>
public sealed class RefineUrlGuardTests
{
    // ==================== IsPrivateOrReserved：應判定為「不安全」的位址 ====================

    /// <summary>
    /// IPv4 迴路 / 私有 / 連結本地 / 雲端中繼資料等網段都應被判定為「私有或保留」（回 true）。
    /// </summary>
    /// <param name="ip">要判斷的 IPv4 字面值。</param>
    [Theory]
    [InlineData("127.0.0.1")]      // 迴路
    [InlineData("127.9.9.9")]      // 整段 127.0.0.0/8 皆迴路
    [InlineData("10.0.0.1")]       // 10.0.0.0/8 私有
    [InlineData("172.16.0.1")]     // 172.16.0.0/12 私有（下界）
    [InlineData("172.31.255.255")] // 172.16.0.0/12 私有（上界）
    [InlineData("192.168.1.1")]    // 192.168.0.0/16 私有
    [InlineData("169.254.169.254")]// 連結本地＋雲端中繼資料端點（SSRF 高風險目標）
    [InlineData("0.0.0.0")]        // 0.0.0.0/8
    public void IsPrivateOrReserved_ReturnsTrue_ForPrivateOrReservedIPv4(string ip)
    {
        // Arrange
        var address = IPAddress.Parse(ip);

        // Act
        var isBlocked = RefineUrlGuard.IsPrivateOrReserved(address);

        // Assert
        isBlocked.Should().BeTrue();
    }

    /// <summary>
    /// 公開可路由的 IPv4 位址不應被誤擋（回 false），否則正常的文章抓取會壞掉。
    /// </summary>
    /// <param name="ip">要判斷的 IPv4 字面值。</param>
    [Theory]
    [InlineData("8.8.8.8")]        // Google DNS
    [InlineData("1.1.1.1")]        // Cloudflare DNS
    [InlineData("172.15.0.1")]     // 172.15.x 在 172.16/12 之外 → 公開
    [InlineData("172.32.0.1")]     // 172.32.x 在 172.16/12 之外 → 公開
    [InlineData("11.0.0.1")]       // 緊鄰 10/8 之外 → 公開
    public void IsPrivateOrReserved_ReturnsFalse_ForPublicIPv4(string ip)
    {
        // Arrange
        var address = IPAddress.Parse(ip);

        // Act
        var isBlocked = RefineUrlGuard.IsPrivateOrReserved(address);

        // Assert
        isBlocked.Should().BeFalse();
    }

    /// <summary>
    /// #35 關鍵回歸：IPv4-mapped IPv6（::ffff:a.b.c.d）必須先攤平回 IPv4 再判，
    /// 否則 ::ffff:127.0.0.1、::ffff:169.254.169.254 等會被當一般 IPv6 而漏擋，形成 SSRF 繞道。
    /// </summary>
    /// <param name="ip">IPv4-mapped IPv6 字面值。</param>
    [Theory]
    [InlineData("::ffff:127.0.0.1")]       // 對應迴路
    [InlineData("::ffff:169.254.169.254")] // 對應雲端中繼資料端點
    [InlineData("::ffff:10.0.0.1")]        // 對應私有網段
    [InlineData("::ffff:192.168.0.1")]     // 對應私有網段
    public void IsPrivateOrReserved_ReturnsTrue_ForIPv4MappedPrivateAddress(string ip)
    {
        // Arrange
        var address = IPAddress.Parse(ip);

        // Act
        var isBlocked = RefineUrlGuard.IsPrivateOrReserved(address);

        // Assert
        isBlocked.Should().BeTrue();
    }

    /// <summary>
    /// IPv4-mapped 到「公開」IPv4 的位址仍應放行（回 false），確認攤平判斷未過度封鎖。
    /// </summary>
    [Fact]
    public void IsPrivateOrReserved_ReturnsFalse_ForIPv4MappedPublicAddress()
    {
        // Arrange
        var address = IPAddress.Parse("::ffff:8.8.8.8");

        // Act
        var isBlocked = RefineUrlGuard.IsPrivateOrReserved(address);

        // Assert
        isBlocked.Should().BeFalse();
    }

    /// <summary>
    /// 原生 IPv6 的迴路 / 連結本地 / 唯一本地位址都應被判定為「私有或保留」（回 true）。
    /// </summary>
    /// <param name="ip">要判斷的 IPv6 字面值。</param>
    [Theory]
    [InlineData("::1")]                  // IPv6 迴路
    [InlineData("fe80::1")]              // 連結本地（fe80::/10）
    [InlineData("fc00::1")]              // 唯一本地（fc00::/7）
    [InlineData("fd12:3456:789a::1")]    // 唯一本地
    public void IsPrivateOrReserved_ReturnsTrue_ForPrivateIPv6(string ip)
    {
        // Arrange
        var address = IPAddress.Parse(ip);

        // Act
        var isBlocked = RefineUrlGuard.IsPrivateOrReserved(address);

        // Assert
        isBlocked.Should().BeTrue();
    }

    /// <summary>
    /// 公開可路由的原生 IPv6 位址不應被誤擋（回 false）。
    /// </summary>
    [Fact]
    public void IsPrivateOrReserved_ReturnsFalse_ForPublicIPv6()
    {
        // Arrange：Google 公用 DNS 的 IPv6。
        var address = IPAddress.Parse("2001:4860:4860::8888");

        // Act
        var isBlocked = RefineUrlGuard.IsPrivateOrReserved(address);

        // Assert
        isBlocked.Should().BeFalse();
    }

    // ==================== ValidateAsync：不需 DNS 即可決定的分支 ====================

    /// <summary>
    /// 非 http/https 協定或無法解析的 URL 應立即拒絕（http/https 白名單）。
    /// </summary>
    /// <param name="url">待驗證的網址。</param>
    [Theory]
    [InlineData("ftp://example.com/file")]
    [InlineData("file:///etc/passwd")]
    [InlineData("gopher://example.com")]
    [InlineData("not-a-valid-url")]
    [InlineData("javascript:alert(1)")]
    public async Task ValidateAsync_Throws_ForNonHttpScheme(string url)
    {
        // Act
        var act = async () => await RefineUrlGuard.ValidateAsync(url, CancellationToken.None);

        // Assert
        await act.Should().ThrowAsync<ArgumentException>();
    }

    /// <summary>
    /// 指向內部主機的名稱（localhost / *.local / 雲端中繼資料）在 DNS 之前就應被短路拒絕。
    /// </summary>
    /// <param name="url">待驗證的網址。</param>
    [Theory]
    [InlineData("http://localhost/admin")]
    [InlineData("https://LocalHost:8080")]                 // 大小寫不敏感
    [InlineData("http://metadata.google.internal/computeMetadata/v1/")]
    [InlineData("http://myprinter.local")]
    public async Task ValidateAsync_Throws_ForInternalHostNames(string url)
    {
        // Act
        var act = async () => await RefineUrlGuard.ValidateAsync(url, CancellationToken.None);

        // Assert
        await act.Should().ThrowAsync<ArgumentException>();
    }

    /// <summary>
    /// 直接以「私有 IP 字面值」構成的 URL 不需 DNS 即應被拒絕（含 IPv4-mapped IPv6 字面值）。
    /// </summary>
    /// <param name="url">待驗證的網址。</param>
    [Theory]
    [InlineData("http://127.0.0.1/")]
    [InlineData("http://169.254.169.254/latest/meta-data/")]
    [InlineData("http://10.0.0.5:3000/")]
    [InlineData("http://192.168.1.1/")]
    [InlineData("http://[::1]/")]
    [InlineData("http://[::ffff:127.0.0.1]/")]
    public async Task ValidateAsync_Throws_ForPrivateIpLiteral(string url)
    {
        // Act
        var act = async () => await RefineUrlGuard.ValidateAsync(url, CancellationToken.None);

        // Assert
        await act.Should().ThrowAsync<ArgumentException>();
    }

    /// <summary>
    /// 以「公開 IP 字面值」構成的 URL 不需 DNS 即可通過（不拋例外），確認守門不會過度封鎖。
    /// </summary>
    /// <param name="url">待驗證的網址。</param>
    [Theory]
    [InlineData("http://8.8.8.8/")]
    [InlineData("https://1.1.1.1/")]
    [InlineData("http://[2001:4860:4860::8888]/")]
    public async Task ValidateAsync_DoesNotThrow_ForPublicIpLiteral(string url)
    {
        // Act
        var act = async () => await RefineUrlGuard.ValidateAsync(url, CancellationToken.None);

        // Assert
        await act.Should().NotThrowAsync();
    }
}
