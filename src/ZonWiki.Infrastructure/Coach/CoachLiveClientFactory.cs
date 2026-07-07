using Microsoft.Extensions.Logging;
using ZonWiki.Infrastructure.Ai;

namespace ZonWiki.Infrastructure.Coach;

/// <summary>
/// <see cref="ICoachLiveClientFactory"/> 的正式實作（singleton）：每次 <see cref="Create"/> new 一顆
/// 全新、尚未連線的 <see cref="CoachLiveClient"/>。重連＝上層向此工廠再要一顆新 client（【審修-A3】）。
///
/// 連線設定（<see cref="CoachLiveConnectionConfig"/>）於註冊時由 Api 從 <c>CoachOptions</c> 取快照注入，
/// 避免 Infrastructure 反向相依 Api。
/// </summary>
public sealed class CoachLiveClientFactory : ICoachLiveClientFactory
{
    private readonly IVertexAdcTokenProvider _tokenProvider;
    private readonly CoachLiveConnectionConfig _config;
    private readonly ILoggerFactory _loggerFactory;

    /// <summary>
    /// 建立 Live client 工廠。
    /// </summary>
    /// <param name="tokenProvider">ADC access token 提供者（每顆 client 握手時取 token）。</param>
    /// <param name="config">連線設定（region／project／model／voice 等）。</param>
    /// <param name="loggerFactory">記錄器工廠（供每顆 client 建自己的 logger）。</param>
    public CoachLiveClientFactory(
        IVertexAdcTokenProvider tokenProvider,
        CoachLiveConnectionConfig config,
        ILoggerFactory loggerFactory)
    {
        _tokenProvider = tokenProvider;
        _config = config;
        _loggerFactory = loggerFactory;
    }

    /// <inheritdoc />
    public ICoachLiveClient Create()
        => new CoachLiveClient(_tokenProvider, _config, _loggerFactory.CreateLogger<CoachLiveClient>());
}
