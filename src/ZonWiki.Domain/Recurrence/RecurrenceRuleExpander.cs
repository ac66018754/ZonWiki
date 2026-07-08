using System.Globalization;

namespace ZonWiki.Domain.Recurrence;

/// <summary>
/// iCal RRULE（RFC 5545）重複規則展開器（僅涵蓋本系統前端會產生的子集，單人系統夠用）。
///
/// 支援：
/// - FREQ = DAILY / WEEKLY / MONTHLY / YEARLY
/// - INTERVAL（間隔，預設 1）
/// - BYDAY（僅 WEEKLY 使用；星期清單，如 MO,WE,FR）
/// - BYMONTHDAY（僅 MONTHLY 使用；月中日清單，如 1,15）
/// - COUNT（總發生次數上限，含錨點本身）
/// - UNTIL（結束時間；yyyyMMdd 或 yyyyMMddTHHmmssZ）
///
/// 不支援的關鍵字一律安全略過（不丟例外、也不亂產生）；無法解析時回傳空清單。
/// 所有時間以 UTC 計算與回傳（<see cref="DateTimeKind.Utc"/>）；發生時間沿用錨點的「時、分、秒」。
/// </summary>
public static class RecurrenceRuleExpander
{
    /// <summary>
    /// 硬性迭代上限（防呆）：即使規則異常，也不會無限展開造成暴衝。
    /// 以「候選日/月」為單位計數，足以涵蓋數十年的日／週／月週期。
    /// </summary>
    private const int MaxIterations = 20000;

    /// <summary>
    /// 依重複規則，自錨點（含）起展開所有「不晚於 untilUtc」的發生時間（UTC，遞增）。
    /// </summary>
    /// <param name="recurrenceRule">iCal RRULE 字串（可含或不含 "RRULE:" 前綴）。</param>
    /// <param name="anchorUtc">序列錨點（第一次發生；通常為母規則卡的排定時間，UTC）。</param>
    /// <param name="untilUtc">展開的時間上界（含）；呼叫端通常帶「現在」以避免預先產生未來發生。</param>
    /// <param name="maxOccurrences">回傳發生數量上限（安全閥；預設 500）。</param>
    /// <returns>遞增排序的發生時間清單（UTC）；規則無效或空時回傳空清單。</returns>
    public static IReadOnlyList<DateTime> Expand(
        string? recurrenceRule,
        DateTime anchorUtc,
        DateTime untilUtc,
        int maxOccurrences = 500)
    {
        var result = new List<DateTime>();
        if (string.IsNullOrWhiteSpace(recurrenceRule) || maxOccurrences <= 0)
        {
            return result;
        }

        var parts = ParseRule(recurrenceRule);
        if (!parts.TryGetValue("FREQ", out var freq))
        {
            return result;
        }

        var interval = ParsePositiveInt(parts, "INTERVAL", fallback: 1);
        var countLimit = ParsePositiveInt(parts, "COUNT", fallback: int.MaxValue);

        // UNTIL（規則自帶結束）與呼叫端上界取較早者。
        var effectiveUntil = untilUtc;
        if (parts.TryGetValue("UNTIL", out var untilRaw)
            && TryParseUntil(untilRaw, out var ruleUntil)
            && ruleUntil < effectiveUntil)
        {
            effectiveUntil = ruleUntil;
        }

        // 統一以 UTC 錨點的「日期」與「時刻」拆解；發生時間 = 候選日期 + 錨點時刻。
        var anchor = DateTime.SpecifyKind(anchorUtc, DateTimeKind.Utc);
        var timeOfDay = anchor.TimeOfDay;
        var anchorDate = anchor.Date;

        // 各頻率各自產生候選；共用「加入結果（含 count/until/max 限制）」的閉包。
        var emitted = 0;
        bool TryEmit(DateTime occurrence)
        {
            if (occurrence < anchor)
            {
                return true; // 早於錨點：略過但繼續（例如月中日排序造成的回頭候選）。
            }
            if (occurrence > effectiveUntil || emitted >= countLimit || result.Count >= maxOccurrences)
            {
                return false; // 觸及上界：通知呼叫端停止。
            }
            result.Add(occurrence);
            emitted++;
            return result.Count < maxOccurrences && emitted < countLimit;
        }

        switch (freq)
        {
            case "DAILY":
                ExpandDaily(anchorDate, timeOfDay, interval, effectiveUntil, TryEmit);
                break;
            case "WEEKLY":
                ExpandWeekly(anchorDate, timeOfDay, interval, parts, effectiveUntil, TryEmit);
                break;
            case "MONTHLY":
                ExpandMonthly(anchorDate, timeOfDay, interval, parts, effectiveUntil, TryEmit);
                break;
            case "YEARLY":
                ExpandYearly(anchorDate, timeOfDay, interval, effectiveUntil, TryEmit);
                break;
            default:
                return result; // 不支援的頻率：安全回傳空。
        }

        result.Sort();
        return result;
    }

    /// <summary>
    /// 每日：自錨點日起，每隔 interval 天一次。
    /// </summary>
    private static void ExpandDaily(
        DateTime anchorDate,
        TimeSpan timeOfDay,
        int interval,
        DateTime until,
        Func<DateTime, bool> tryEmit)
    {
        var iterations = 0;
        for (var date = anchorDate; date.Add(timeOfDay) <= until && iterations < MaxIterations; date = date.AddDays(interval))
        {
            iterations++;
            if (!tryEmit(DateTime.SpecifyKind(date.Add(timeOfDay), DateTimeKind.Utc)))
            {
                return;
            }
        }
    }

    /// <summary>
    /// 每週：BYDAY 指定的星期；每隔 interval 週一次（以錨點所在週為第 0 週）。
    /// 未指定 BYDAY 時，退回錨點當天的星期。
    /// </summary>
    private static void ExpandWeekly(
        DateTime anchorDate,
        TimeSpan timeOfDay,
        int interval,
        IReadOnlyDictionary<string, string> parts,
        DateTime until,
        Func<DateTime, bool> tryEmit)
    {
        var weekdays = ParseByDay(parts);
        if (weekdays.Count == 0)
        {
            weekdays.Add(anchorDate.DayOfWeek);
        }

        // 錨點所在「週一」為對齊基準，用來判斷第幾週（符合 interval 週期）。
        var anchorWeekStart = StartOfIsoWeek(anchorDate);

        var iterations = 0;
        for (var date = anchorDate; date.Add(timeOfDay) <= until && iterations < MaxIterations; date = date.AddDays(1))
        {
            iterations++;
            if (!weekdays.Contains(date.DayOfWeek))
            {
                continue;
            }
            var weekIndex = (int)Math.Floor((StartOfIsoWeek(date) - anchorWeekStart).TotalDays / 7.0);
            if (weekIndex % interval != 0)
            {
                continue;
            }
            if (!tryEmit(DateTime.SpecifyKind(date.Add(timeOfDay), DateTimeKind.Utc)))
            {
                return;
            }
        }
    }

    /// <summary>
    /// 每月：BYMONTHDAY 指定的月中日；每隔 interval 個月一次。
    /// 未指定 BYMONTHDAY 時，退回錨點當日（該月無此日則略過，例如 31 日）。
    /// </summary>
    private static void ExpandMonthly(
        DateTime anchorDate,
        TimeSpan timeOfDay,
        int interval,
        IReadOnlyDictionary<string, string> parts,
        DateTime until,
        Func<DateTime, bool> tryEmit)
    {
        var monthDays = ParseByMonthDay(parts);
        if (monthDays.Count == 0)
        {
            monthDays.Add(anchorDate.Day);
        }
        monthDays.Sort();

        var monthCursor = new DateTime(anchorDate.Year, anchorDate.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var iterations = 0;
        while (iterations < MaxIterations)
        {
            iterations++;
            var daysInMonth = DateTime.DaysInMonth(monthCursor.Year, monthCursor.Month);
            foreach (var day in monthDays)
            {
                if (day < 1 || day > daysInMonth)
                {
                    continue; // 該月不存在此日（如 2 月 30 日）→ 略過。
                }
                var occurrence = new DateTime(monthCursor.Year, monthCursor.Month, day, 0, 0, 0, DateTimeKind.Utc)
                    .Add(timeOfDay);
                if (occurrence > until)
                {
                    // 同月剩餘日仍可能更早（理論上已排序遞增），但跨月一定更晚 → 直接結束。
                    return;
                }
                if (!tryEmit(occurrence))
                {
                    return;
                }
            }
            monthCursor = monthCursor.AddMonths(interval);
            // 若下個週期的月初已超過上界，提前結束。
            if (monthCursor.Add(timeOfDay) > until && monthCursor > until)
            {
                return;
            }
        }
    }

    /// <summary>
    /// 每年：自錨點日起，每隔 interval 年一次（沿用錨點的月/日；2/29 遇平年則略過）。
    /// </summary>
    private static void ExpandYearly(
        DateTime anchorDate,
        TimeSpan timeOfDay,
        int interval,
        DateTime until,
        Func<DateTime, bool> tryEmit)
    {
        var iterations = 0;
        for (var year = anchorDate.Year; iterations < MaxIterations; year += interval)
        {
            iterations++;
            // 2/29 在平年不存在 → 略過該年。
            if (anchorDate.Month == 2 && anchorDate.Day == 29 && !DateTime.IsLeapYear(year))
            {
                if (new DateTime(year, 1, 1, 0, 0, 0, DateTimeKind.Utc).Add(timeOfDay) > until)
                {
                    return;
                }
                continue;
            }
            var occurrence = new DateTime(year, anchorDate.Month, anchorDate.Day, 0, 0, 0, DateTimeKind.Utc)
                .Add(timeOfDay);
            if (occurrence > until)
            {
                return;
            }
            if (!tryEmit(occurrence))
            {
                return;
            }
        }
    }

    /// <summary>
    /// 解析 RRULE 字串為「大寫關鍵字 → 值」的字典（去除可選的 "RRULE:" 前綴）。
    /// </summary>
    private static Dictionary<string, string> ParseRule(string recurrenceRule)
    {
        var body = recurrenceRule.Trim();
        if (body.StartsWith("RRULE:", StringComparison.OrdinalIgnoreCase))
        {
            body = body["RRULE:".Length..];
        }

        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var segment in body.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var kv = segment.Split('=', 2);
            if (kv.Length == 2 && kv[0].Length > 0)
            {
                map[kv[0].Trim().ToUpperInvariant()] = kv[1].Trim();
            }
        }
        return map;
    }

    /// <summary>
    /// 解析 BYDAY（星期清單，如 MO,WE,FR）為 <see cref="DayOfWeek"/> 集合；忽略前綴序數（如 +2MO）。
    /// </summary>
    private static HashSet<DayOfWeek> ParseByDay(IReadOnlyDictionary<string, string> parts)
    {
        var set = new HashSet<DayOfWeek>();
        if (!parts.TryGetValue("BYDAY", out var raw))
        {
            return set;
        }
        foreach (var token in raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            // 取末兩碼作為星期代碼（相容 "+2MO" 這類含序數的寫法；本系統前端不產生序數）。
            var code = token.Length >= 2 ? token[^2..].ToUpperInvariant() : token.ToUpperInvariant();
            var day = code switch
            {
                "SU" => (DayOfWeek?)DayOfWeek.Sunday,
                "MO" => DayOfWeek.Monday,
                "TU" => DayOfWeek.Tuesday,
                "WE" => DayOfWeek.Wednesday,
                "TH" => DayOfWeek.Thursday,
                "FR" => DayOfWeek.Friday,
                "SA" => DayOfWeek.Saturday,
                _ => null,
            };
            if (day.HasValue)
            {
                set.Add(day.Value);
            }
        }
        return set;
    }

    /// <summary>
    /// 解析 BYMONTHDAY（月中日清單，如 1,15）為正整數清單；忽略非法值（本系統不支援負數日）。
    /// </summary>
    private static List<int> ParseByMonthDay(IReadOnlyDictionary<string, string> parts)
    {
        var days = new List<int>();
        if (!parts.TryGetValue("BYMONTHDAY", out var raw))
        {
            return days;
        }
        foreach (var token in raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (int.TryParse(token, NumberStyles.Integer, CultureInfo.InvariantCulture, out var day)
                && day is >= 1 and <= 31)
            {
                days.Add(day);
            }
        }
        return days;
    }

    /// <summary>
    /// 解析正整數關鍵字值；缺省或非法時回傳 fallback。
    /// </summary>
    private static int ParsePositiveInt(IReadOnlyDictionary<string, string> parts, string key, int fallback)
    {
        if (parts.TryGetValue(key, out var raw)
            && int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var value)
            && value > 0)
        {
            return value;
        }
        return fallback;
    }

    /// <summary>
    /// 解析 UNTIL 值：支援 "yyyyMMddTHHmmssZ"（含時刻）與 "yyyyMMdd"（純日期，視為當日 23:59:59）。
    /// </summary>
    private static bool TryParseUntil(string raw, out DateTime until)
    {
        raw = raw.Trim();
        if (DateTime.TryParseExact(
                raw,
                "yyyyMMdd'T'HHmmss'Z'",
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var withTime))
        {
            until = DateTime.SpecifyKind(withTime, DateTimeKind.Utc);
            return true;
        }
        if (DateTime.TryParseExact(
                raw,
                "yyyyMMdd",
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var dateOnly))
        {
            // 純日期的 UNTIL 視為「該日整天有效」，故取當日尾端。
            until = DateTime.SpecifyKind(dateOnly.Date.AddDays(1).AddSeconds(-1), DateTimeKind.Utc);
            return true;
        }
        until = default;
        return false;
    }

    /// <summary>
    /// 取得指定日期所在 ISO 週的「週一」（作為週期對齊基準）。
    /// </summary>
    private static DateTime StartOfIsoWeek(DateTime date)
    {
        var diff = (int)date.DayOfWeek - (int)DayOfWeek.Monday;
        if (diff < 0)
        {
            diff += 7; // 週日視為該週最後一天（其週一在前 6 天）。
        }
        return date.Date.AddDays(-diff);
    }
}
