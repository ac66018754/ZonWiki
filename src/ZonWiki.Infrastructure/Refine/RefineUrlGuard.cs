using System.Net;
using System.Net.Sockets;

namespace ZonWiki.Infrastructure.Refine;

/// <summary>
/// 「精煉成筆記」共用的 URL 安全守門（SSRF 防護）。
/// yt-dlp 擷取與文章抓取都用同一套：只允許 http/https；阻擋 localhost、私有/迴路/連結本地 IP、
/// 雲端中繼資料端點（含 GCP 169.254.169.254）。主機名稱會解析成 IP 再核對，避免指向內網。
/// 亦處理 IPv4-mapped IPv6 繞道；DNS 解析失敗一律 fail-closed（拒絕、不放行）。
/// 注意：本守門只驗證「傳入的 URL」；抓取端若會跟隨 HTTP 轉址，須對每個轉址目標再呼叫一次
/// <see cref="ValidateAsync"/>（見 ArticleFetchService 的逐跳重驗）。
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
            catch (Exception ex) when (ex is SocketException or ArgumentException or InvalidOperationException)
            {
                // fail-closed：解析不到就「拒絕」，不放行。
                // 放行等於把「是否安全」的判斷丟給抓取端，攻擊者可用「首解析失敗、抓取端重試時才解到內網 IP」
                // 這類 DNS rebinding／時序技巧繞過守門，故一律擋下（鐵則：安全預設拒絕）。
                throw new ArgumentException("無法解析主機名稱，基於安全考量拒絕此網址。", ex);
            }
        }

        // 解析成功但沒有任何位址：同樣 fail-closed，不放行。
        if (addresses.Length == 0)
        {
            throw new ArgumentException("主機名稱未解析到任何 IP，基於安全考量拒絕此網址。");
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
    /// <param name="ip">要判斷的 IP 位址。</param>
    /// <returns>屬於迴路 / 私有 / 保留網段時回 true。</returns>
    public static bool IsPrivateOrReserved(IPAddress ip)
    {
        // IPv4-mapped IPv6（::ffff:a.b.c.d）先攤平回 IPv4 再判，
        // 否則像 ::ffff:127.0.0.1、::ffff:169.254.169.254 會被當成一般 IPv6 而漏擋，形成 SSRF 繞道。
        if (ip.IsIPv4MappedToIPv6)
        {
            ip = ip.MapToIPv4();
        }

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
