using ZonWiki.Domain.Entities;

namespace ZonWiki.Domain.Srs;

/// <summary>
/// 四鍵複習評分（對應設計書 §3.4 的 Again／Hard／Good／Easy）。
/// 列舉值刻意對齊 SM-2 quality 尺度的上緣（見 <see cref="Sm2Scheduler"/> 的 quality 映射），
/// 讓 EF 調整溫和、且 Again 正確落入「重置」分支。
/// </summary>
public enum VocabularyRating
{
    /// <summary>
    /// 完全想不起來（遺忘）：重置間隔、已畢業卡累加遺忘次數。
    /// </summary>
    Again = 1,

    /// <summary>
    /// 想起來但很吃力：成功但間隔成長最慢、EF 略降。
    /// </summary>
    Hard = 2,

    /// <summary>
    /// 正常想起：標準間隔成長、EF 不變。
    /// </summary>
    Good = 3,

    /// <summary>
    /// 輕鬆想起：間隔成長最快、EF 上升。
    /// </summary>
    Easy = 4,
}

/// <summary>
/// 單字卡的 SM-2 排程狀態（純資料，無時鐘）。
/// 對應資料表的 SRS 欄位：<see cref="EasinessFactor"/>→_Difficulty、<see cref="IntervalDays"/>→_Stability、
/// <see cref="Repetitions"/>→_Reps、<see cref="Lapses"/>→_Lapses、<see cref="State"/>→_State。
/// </summary>
/// <param name="EasinessFactor">SM-2 難易因子（EF，越大越容易；下限 1.3）。存 _Difficulty 欄。</param>
/// <param name="Repetitions">連續成功次數 n（Again 歸零）。存 _Reps 欄。</param>
/// <param name="Lapses">遺忘次數（僅已畢業卡遺忘時累加）。存 _Lapses 欄。</param>
/// <param name="IntervalDays">目前排程間隔（天）。存 _Stability 欄，並作為成熟卡下次間隔的乘算基底。</param>
/// <param name="State">卡片狀態列舉。存 _State 欄。</param>
public readonly record struct Sm2State(
    double EasinessFactor,
    int Repetitions,
    int Lapses,
    double IntervalDays,
    VocabularyReviewState State);

/// <summary>
/// 單字卡複習後的 SM-2 排程結果（欄位形狀與 <see cref="Sm2State"/> 相同，代表「複習後的新狀態」）。
/// <see cref="IntervalDays"/> 為本次算出的「下次間隔（天）」；實際到期時間由服務層以 <c>now + IntervalDays</c> 計算
/// （純函式刻意不含時鐘，易測且無時區疑慮）。
/// </summary>
/// <param name="EasinessFactor">更新後的 EF（下限 1.3）。</param>
/// <param name="Repetitions">更新後的連續成功次數 n。</param>
/// <param name="Lapses">更新後的遺忘次數。</param>
/// <param name="IntervalDays">下次間隔（整數天，下限 1）。</param>
/// <param name="State">更新後的卡片狀態。</param>
public readonly record struct Sm2Result(
    double EasinessFactor,
    int Repetitions,
    int Lapses,
    double IntervalDays,
    VocabularyReviewState State);

/// <summary>
/// SM-2 間隔排程器（純函式、置於 Domain、零相依、可單元測試）。範本精神比照
/// <see cref="Recurrence.RecurrenceRuleExpander"/>。
///
/// 設計取捨（設計書 §3.1）：本波以 SM-2 起步，但 DB 欄位照 FSRS 形狀設計，值由 SM-2 填入
///（EF→_Difficulty、間隔→_Stability、n→_Reps……），目的是「未來換 FSRS 不動表」。
/// 各鍵的「下次間隔預覽」與「實際複習結果」走同一段計算（<see cref="Compute"/>），保證
/// 前端看到的預覽＝按下去的實際排程（設計書 §3.4／§3.1「排程一律後端計算，DB-as-truth」）。
/// </summary>
public static class Sm2Scheduler
{
    /// <summary>新卡的初始 EF（經典 SM-2 起始值 2.5）。存入 _Difficulty。</summary>
    public const double InitialEasinessFactor = 2.5;

    /// <summary>EF 下限（經典 SM-2 為 1.3；連按 Again 會觸及此下限後不再下降）。</summary>
    public const double MinEasinessFactor = 1.3;

    /// <summary>Hard 對成熟卡的間隔乘數（1.2；恆小於 EF 下限 1.3，保證 Hard&lt;Good）。</summary>
    public const double HardIntervalMultiplier = 1.2;

    /// <summary>Easy 的額外加成乘數（1.3；套在 Good 間隔之上，保證 Easy&gt;Good）。</summary>
    public const double EasyBonus = 1.3;

    /// <summary>首次成功（畢業）的基礎間隔（天）。</summary>
    public const double FirstIntervalDays = 1;

    /// <summary>第二次成功的基礎間隔（天）。</summary>
    public const double SecondIntervalDays = 6;

    /// <summary>新卡直接按 Easy 畢業時的首間隔（天）。</summary>
    public const double EasyFirstIntervalDays = 4;

    /// <summary>
    /// 間隔上限（天；36500＝100 年，對齊 Anki 慣例）。
    /// 成熟卡連按 Easy 會以 <c>前一間隔 × EF × EasyBonus</c> 連乘暴衝，若不設上限，數次後間隔可達千萬天，
    /// 讓服務層 <c>now.AddDays(interval)</c>（實際排程與清單預覽共用）拋 <see cref="ArgumentOutOfRangeException"/>
    ///（DateTime 上限 9999 年）→ 未攔截 500，甚至讓「每次 GET 清單」都因預覽溢位而 500。
    /// 由於預覽與實際排程共用 <see cref="RoundInterval"/> 這條唯一計算路徑，於此統一夾住上限即可全面保護。
    /// </summary>
    public const double MaxIntervalDays = 36500;

    /// <summary>
    /// 建立一張新卡的初始排程狀態：EF=2.5、n=0、lapses=0、interval=0、State=New。
    /// </summary>
    /// <returns>新卡的初始 <see cref="Sm2State"/>。</returns>
    public static Sm2State NewCard() =>
        new(InitialEasinessFactor, Repetitions: 0, Lapses: 0, IntervalDays: 0, VocabularyReviewState.New);

    /// <summary>
    /// 對一張卡以指定評分做一次複習，回傳更新後的排程結果（純函式；不含時鐘）。
    /// </summary>
    /// <param name="current">複習前的排程狀態。</param>
    /// <param name="rating">四鍵評分。</param>
    /// <returns>複習後的新狀態與下次間隔。</returns>
    public static Sm2Result Review(Sm2State current, VocabularyRating rating) => Compute(current, rating);

    /// <summary>
    /// 對一張卡預覽「四鍵各自會產生的下次間隔（天）」。
    /// 與 <see cref="Review"/> 共用 <see cref="Compute"/>，保證預覽＝實際結果。
    /// </summary>
    /// <param name="current">目前的排程狀態。</param>
    /// <returns>四鍵→下次間隔（天）的映射。</returns>
    public static IReadOnlyDictionary<VocabularyRating, double> PreviewIntervals(Sm2State current)
    {
        return new Dictionary<VocabularyRating, double>
        {
            [VocabularyRating.Again] = Compute(current, VocabularyRating.Again).IntervalDays,
            [VocabularyRating.Hard] = Compute(current, VocabularyRating.Hard).IntervalDays,
            [VocabularyRating.Good] = Compute(current, VocabularyRating.Good).IntervalDays,
            [VocabularyRating.Easy] = Compute(current, VocabularyRating.Easy).IntervalDays,
        };
    }

    /// <summary>
    /// 解析評分字串（大小寫不敏感）："again"/"hard"/"good"/"easy" → <see cref="VocabularyRating"/>；
    /// 非法值拋 <see cref="ArgumentException"/>（端點據此回 400）。
    /// </summary>
    /// <param name="raw">評分字串。</param>
    /// <returns>對應的評分列舉。</returns>
    /// <exception cref="ArgumentException">當字串不是四個合法評分之一。</exception>
    public static VocabularyRating ParseRating(string raw)
    {
        var normalized = (raw ?? string.Empty).Trim().ToLowerInvariant();
        return normalized switch
        {
            "again" => VocabularyRating.Again,
            "hard" => VocabularyRating.Hard,
            "good" => VocabularyRating.Good,
            "easy" => VocabularyRating.Easy,
            _ => throw new ArgumentException(
                $"非法的複習評分：'{raw}'（合法值：again／hard／good／easy）。", nameof(raw)),
        };
    }

    /// <summary>
    /// 單一權威計算路徑：由「複習前狀態＋評分」算出「複習後狀態＋下次間隔」。
    /// <see cref="Review"/> 與 <see cref="PreviewIntervals"/> 皆委派至此，確保兩者一致。
    /// </summary>
    /// <param name="current">複習前狀態。</param>
    /// <param name="rating">四鍵評分。</param>
    /// <returns>複習後的新狀態。</returns>
    private static Sm2Result Compute(Sm2State current, VocabularyRating rating)
    {
        var quality = QualityOf(rating);

        // EF 每次複習都更新（含 Again，經典 SM-2）；下限 clamp 到 1.3。
        var updatedEf = UpdateEasinessFactor(current.EasinessFactor, quality);

        // Again（q<3，遺忘/重置）：間隔歸 1、n 歸零、狀態依原狀態轉移、已畢業卡累加遺忘。
        if (quality < 3)
        {
            var lapses = current.Lapses + (current.State == VocabularyReviewState.Review ? 1 : 0);
            var state = current.State switch
            {
                VocabularyReviewState.Review => VocabularyReviewState.Relearning, // 已畢業卡遺忘→重新學習
                VocabularyReviewState.New => VocabularyReviewState.Learning,       // 新卡首次失敗→學習中
                _ => current.State,                                                // Learning／Relearning 維持
            };

            return new Sm2Result(
                EasinessFactor: updatedEf,
                Repetitions: 0,
                Lapses: lapses,
                IntervalDays: RoundInterval(FirstIntervalDays),
                State: state);
        }

        // Hard/Good/Easy（q≥3，成功）：依連續成功次數 n 決定基礎間隔。
        var interval = SuccessIntervalDays(current, rating);
        var repetitions = current.Repetitions + 1;

        return new Sm2Result(
            EasinessFactor: updatedEf,
            Repetitions: repetitions,
            Lapses: current.Lapses,
            IntervalDays: interval,
            // New／Learning／Relearning 首次成功即畢業→Review；Review 維持 Review。
            State: VocabularyReviewState.Review);
    }

    /// <summary>
    /// 成功評分（Hard/Good/Easy）的下次間隔（整數天，下限 1）。
    /// n==0（首次成功/畢業）與 n==1（第二次成功）為固定階梯；n≥2（成熟卡）以前一間隔乘算，
    /// 並保底 <c>max(前一間隔+1, 乘算值)</c> 防停滯。
    /// </summary>
    /// <param name="current">複習前狀態。</param>
    /// <param name="rating">成功類評分（Hard/Good/Easy）。</param>
    /// <returns>下次間隔（整數天，下限 1）。</returns>
    private static double SuccessIntervalDays(Sm2State current, VocabularyRating rating)
    {
        // 早期固定階梯（n∈{0,1}）：Hard≈Good 為刻意簡化（設計書 §3.4 審查點）。
        if (current.Repetitions == 0)
        {
            return rating == VocabularyRating.Easy
                ? RoundInterval(EasyFirstIntervalDays)   // 4
                : RoundInterval(FirstIntervalDays);       // 1（Good/Hard）
        }

        if (current.Repetitions == 1)
        {
            return rating == VocabularyRating.Easy
                ? RoundInterval(SecondIntervalDays * EasyBonus) // round(6×1.3)=8
                : RoundInterval(SecondIntervalDays);            // 6（Good/Hard）
        }

        // 成熟卡（n≥2）：以前一間隔 I 為基底乘算，確保 Hard<Good<Easy 單調（EF≥1.3>1.2）。
        var previousInterval = current.IntervalDays;
        var multiplied = rating switch
        {
            VocabularyRating.Hard => previousInterval * HardIntervalMultiplier,
            VocabularyRating.Easy => previousInterval * current.EasinessFactor * EasyBonus,
            _ => previousInterval * current.EasinessFactor, // Good
        };

        // 保底：至少比前一間隔多 1 天（防 EF 接近下限時停滯）。
        var floored = Math.Max(previousInterval + 1, multiplied);
        return RoundInterval(floored);
    }

    /// <summary>
    /// 經典 SM-2 的 EF 更新公式：<c>EF' = EF + (0.1 − (5−q)(0.08 + (5−q)0.02))</c>，下限 clamp 到 1.3。
    /// </summary>
    /// <param name="easinessFactor">目前 EF。</param>
    /// <param name="quality">SM-2 quality（Again=2／Hard=3／Good=4／Easy=5）。</param>
    /// <returns>更新並下限 clamp 後的 EF。</returns>
    private static double UpdateEasinessFactor(double easinessFactor, int quality)
    {
        var delta = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
        var updated = easinessFactor + delta;
        return updated < MinEasinessFactor ? MinEasinessFactor : updated;
    }

    /// <summary>
    /// 四鍵→SM-2 quality 映射（取尺度上緣：Again=2／Hard=3／Good=4／Easy=5，見 §3.3）。
    /// </summary>
    /// <param name="rating">四鍵評分。</param>
    /// <returns>對應的 SM-2 quality。</returns>
    private static int QualityOf(VocabularyRating rating) => rating switch
    {
        VocabularyRating.Again => 2,
        VocabularyRating.Hard => 3,
        VocabularyRating.Good => 4,
        VocabularyRating.Easy => 5,
        _ => 4,
    };

    /// <summary>
    /// 間隔取整規則（鎖定行為，避免非決定性）：<c>Math.Round(x, MidpointRounding.AwayFromZero)</c> 後轉整數，
    /// 再套下限 1（間隔至少 1 天）與上限 <see cref="MaxIntervalDays"/>（避免間隔暴衝溢位）。
    /// 半數邊界（.5 結尾）一律「遠離零」進位（例：12.5→13）。
    /// 這是預覽與實際排程共用的唯一計算收斂點，故上限一夾即同時保護兩條路徑（見 <see cref="MaxIntervalDays"/>）。
    /// </summary>
    /// <param name="days">未取整的間隔天數。</param>
    /// <returns>取整並套上下限後的間隔天數（1 ≤ 回傳值 ≤ <see cref="MaxIntervalDays"/>）。</returns>
    private static double RoundInterval(double days)
    {
        var rounded = Math.Round(days, MidpointRounding.AwayFromZero);
        if (rounded < 1)
        {
            return 1;
        }

        // 夾住上限：防成熟卡連按 Easy 讓間隔連乘暴衝，導致 now.AddDays(interval) 溢位成未攔截 500。
        return Math.Min(rounded, MaxIntervalDays);
    }
}
