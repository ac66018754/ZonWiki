namespace ZonWiki.Domain.Dtos;

/// <summary>
/// 記帳分析頁（其他功能群 Phase 2）的彙總回應：一次回全部圖表所需資料。
///
/// 前端只發一個請求即可繪出五大區塊：
/// 本月總額＋與上月比（stat tile）、近 N 月趨勢（柱狀）、分類佔比（環圈＋下鑽）、
/// 日曆熱圖（每日總額）、商家 Top N。
///
/// 金額一律 decimal、時間一律 UTC；月／日分組皆以 UTC 邊界計算（見 <c>ExpenseMonthRange</c>）。
/// v1 幣別假設一律 TWD（沿用既有 <c>ExpenseStatsDto</c> 慣例），不做多幣別加總。
/// 序列化為 camelCase（<see cref="System.Text.Json.JsonSerializerDefaults.Web"/>）。
/// </summary>
/// <param name="Month">分析的月份（YYYY-MM，UTC 月界；回顯入參正規化後的值）。</param>
/// <param name="MonthTotal">該月有效消費總額（軟刪除已排除）；空月為 0。</param>
/// <param name="MonthCount">該月有效消費筆數；空月為 0。</param>
/// <param name="PrevMonthTotal">上一個月（該月 -1）有效消費總額；無資料為 0。</param>
/// <param name="DeltaPct">
/// 與上月比的百分比變化（四捨五入 1 位小數，<see cref="System.MidpointRounding.AwayFromZero"/>）。
/// 公式 <c>(MonthTotal - PrevMonthTotal) / PrevMonthTotal * 100</c>；
/// <c>PrevMonthTotal == 0</c> 時為 <c>null</c>（前端顯示「—／新增」，避免除以零）。
/// </param>
/// <param name="MonthlyTrend">
/// 近 N 月趨勢（預設 N=6），時序升冪（最舊 → 選定月），含補零月份（連續 N 筆，缺月 total=0、count=0）；
/// 末筆＝選定月，其 total 等於 <paramref name="MonthTotal"/>。
/// </param>
/// <param name="CategoryBreakdown">選定月分類佔比（環圈＋下鑽用），按 total 降冪；未分類自成一桶（Id／Name／Icon 皆 null）。</param>
/// <param name="DailyTotals">選定月每日總額（日曆熱圖用），按 date 升冪，只含有資料的日（前端自建整月格子、缺日補 0）。</param>
/// <param name="MerchantTopN">選定月商家 Top N（預設 10），按 total 降冪；排除商家為 null／空白者。</param>
public sealed record ExpenseAnalyticsDto(
    string Month,
    decimal MonthTotal,
    int MonthCount,
    decimal PrevMonthTotal,
    decimal? DeltaPct,
    IReadOnlyList<MonthlyTrendPointDto> MonthlyTrend,
    IReadOnlyList<CategoryBreakdownItemDto> CategoryBreakdown,
    IReadOnlyList<DailyTotalDto> DailyTotals,
    IReadOnlyList<MerchantTotalDto> MerchantTopN);

/// <summary>
/// 近 N 月趨勢的單一資料點（供月趨勢柱狀圖）。
/// </summary>
/// <param name="Month">月份（YYYY-MM，UTC 月界）。</param>
/// <param name="Total">該月有效消費總額；缺月補 0。</param>
/// <param name="Count">該月有效消費筆數；缺月補 0（供 tooltip 顯示「N 筆」）。</param>
public sealed record MonthlyTrendPointDto(
    string Month,
    decimal Total,
    int Count);

/// <summary>
/// 分類佔比的單一項目（供環圈圖＋下鑽）。
/// </summary>
/// <param name="CategoryId">分類識別碼；<c>null</c> 代表「未分類」桶。</param>
/// <param name="Name">分類名稱；<c>null</c> 代表未分類（前端顯示「未分類」）。</param>
/// <param name="Icon">分類圖示（emoji）；未分類為 <c>null</c>。</param>
/// <param name="Total">該分類該月總額。</param>
/// <param name="Count">該分類該月筆數。</param>
public sealed record CategoryBreakdownItemDto(
    Guid? CategoryId,
    string? Name,
    string? Icon,
    decimal Total,
    int Count);

/// <summary>
/// 日彙總的單一資料點（供日曆熱圖）。
/// </summary>
/// <param name="Date">日期（YYYY-MM-DD，UTC 日界）。</param>
/// <param name="Total">當日有效消費總額。</param>
/// <param name="Count">當日有效消費筆數。</param>
public sealed record DailyTotalDto(
    string Date,
    decimal Total,
    int Count);

/// <summary>
/// 商家彙總的單一項目（供商家 Top N）。
/// </summary>
/// <param name="Merchant">商家名稱（正規化後；已排除 null／空白）。</param>
/// <param name="Total">該商家該月總額。</param>
/// <param name="Count">該商家該月筆數。</param>
public sealed record MerchantTotalDto(
    string Merchant,
    decimal Total,
    int Count);
