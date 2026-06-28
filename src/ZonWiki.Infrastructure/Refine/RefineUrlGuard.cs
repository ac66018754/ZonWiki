using System.Net;
using System.Net.Sockets;

namespace ZonWiki.Infrastructure.Refine;

/// <summary>
/// 「精煉成筆記」共用的 URL 安全守門（SSRF 防護）。
/// yt-dlp 擷取與文章抓取都用同一套：只允許 http/https；阻擋 localhost、私有/迴路/連結本地 IP、
/// 雲端中繼資料端點（含 GCP 169.254.169.254）。主機名稱會解析成 IP 再核對，避免指向內網。
/// </summary>
public static class RefineUrlGuard
{
    /// <summary>
    /// 驗證 URL 是否安全（可對外抓取）。不安全時拋 <see cref="ArgumentException"/>。
    /// </summary>
    /// <param name="url">要抓取的連結。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    public static async Task ValidateAsync(string url, CancellationToken cancellationToken)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            throw new ArgumentException("只接受 http/https 的網址。");
        }

        var host = uri.Host;
        if (host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            || host.Equals("metadata.google.internal", StringComparison.OrdinalIgnoreCase)
            || host.EndsWith(".local", StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException("不允許指向內部主機的網址。");
        }

        IPAddress[] addresses;
        if (IPAddress.TryParse(host, out var literal))
        {
            addresses = new[] { literal };
        }
        else
        {
            try
            {
                addresses = await Dns.GetHostAddressesAsync(host, cancellationToken);
            }
            catch
            {
                // 解析不到就放行讓抓取端自己去碰（多半是暫時性 DNS 問題）。
                return;
            }
        }

        foreach (var ip in addresses)
        {
            if (IsPrivateOrReserved(ip))
            {
                throw new ArgumentException("不允許指向內部 / 私有網路的網址。");
            }
        }
    }

    /// <summary>判斷 IP 是否為迴路 / 私有 / 連結本地（含雲端中繼資料 169.254.169.254）。</summary>
    public static bool IsPrivateOrReserved(IPAddress ip)
    {
        if (IPAddress.IsLoopback(ip))
        {
            return true;
        }

        if (ip.AddressFamily == AddressFamily.InterNetwork)
        {
            var b = ip.GetAddressBytes();
            return b[0] == 10                                   // 10.0.0.0/8
                || (b[0] == 172 && b[1] >= 16 && b[1] <= 31)    // 172.16.0.0/12
                || (b[0] == 192 && b[1] == 168)                 // 192.168.0.0/16
                || (b[0] == 169 && b[1] == 254)                 // 169.254.0.0/16（含中繼資料）
                || b[0] == 0
                || b[0] == 127;
        }

        if (ip.AddressFamily == AddressFamily.InterNetworkV6)
        {
            return ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal || ip.IsIPv6UniqueLocal;
        }

        return false;
    }
}
