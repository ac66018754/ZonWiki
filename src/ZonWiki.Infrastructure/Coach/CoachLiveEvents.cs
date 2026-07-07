using System.Text.Json;

namespace ZonWiki.Infrastructure.Coach;

/// <summary>
/// Vertex Live 連線的 setup 參數（由上層 <c>CoachProxyService</c> 組好交給 <see cref="CoachLiveClient"/>）。
///
/// 職責邊界：連線目標（region／project／model／voice／language／triggerTokens）由 client 從
/// <c>CoachOptions</c> 讀取；此 record 只攜帶「每場才知道」的 systemInstruction。續連句柄
/// （resumptionHandle）另以 <c>ConnectAsync</c> 的參數傳入（<b>只由伺服器從 DB 取，絕不接受前端傳入</b>）。
/// </summary>
/// <param name="SystemInstruction">後端組裝的英文教練 system prompt（設計書 §4.6；已含到期單字／前次摘要）。</param>
public sealed record CoachLiveSetup(string SystemInstruction);

/// <summary>
/// 一筆模型要求呼叫的 Function Call（來自 Vertex 的 <c>toolCall.functionCalls[]</c>）。
/// </summary>
/// <param name="Id">呼叫識別碼（回覆 toolResponse 時必須原樣回填）。</param>
/// <param name="Name">函式名稱（add_vocabulary／show_correction）。</param>
/// <param name="ArgumentsJson">參數 JSON 原文（保留原字串，供上層自行解析與長度驗證）。</param>
public sealed record CoachToolCall(string Id, string Name, string ArgumentsJson);

/// <summary>
/// <see cref="CoachLiveClient"/> 收訊迴圈向上派發的伺服器事件基底型別（discriminated union）。
/// 上層 <c>CoachProxyService</c> 以 <c>switch</c> 消費；client <b>自己不重連、不落地</b>，只翻譯協定為事件。
/// </summary>
public abstract record CoachLiveServerEvent;

/// <summary>握手完成（收到 <c>setupComplete</c>）；上層據此開始泵送瀏覽器音訊。</summary>
public sealed record CoachReadyEvent : CoachLiveServerEvent;

/// <summary>模型輸出音訊（下行固定 24kHz PCM16；<c>data</c> 為 base64 原文，代理不轉碼直接轉發前端）。</summary>
/// <param name="Base64Pcm24">base64 編碼的 24kHz PCM16 音訊片段。</param>
public sealed record CoachAudioOutEvent(string Base64Pcm24) : CoachLiveServerEvent;

/// <summary>教練（assistant）逐字稿片段（<c>serverContent.outputTranscription.text</c>）。</summary>
/// <param name="Text">本次逐字稿片段文字。</param>
public sealed record CoachAssistantTranscriptEvent(string Text) : CoachLiveServerEvent;

/// <summary>使用者（learner）逐字稿片段（<c>serverContent.inputTranscription.text</c>）。</summary>
/// <param name="Text">本次逐字稿片段文字。</param>
public sealed record CoachUserTranscriptEvent(string Text) : CoachLiveServerEvent;

/// <summary>使用者插話打斷（barge-in；<c>serverContent.interrupted:true</c>）。</summary>
public sealed record CoachInterruptedEvent : CoachLiveServerEvent;

/// <summary>模型本回合生成結束（<c>serverContent.generationComplete</c>；音訊可能還在傳）。</summary>
public sealed record CoachGenerationCompleteEvent : CoachLiveServerEvent;

/// <summary>整個回合結束（<c>serverContent.turnComplete</c>）；上層據此把累積逐字稿落地成一則 CoachMessage。</summary>
public sealed record CoachTurnCompleteEvent : CoachLiveServerEvent;

/// <summary>模型要求呼叫函式（<c>toolCall.functionCalls[]</c>）。</summary>
/// <param name="Calls">本則含的所有 Function Call。</param>
public sealed record CoachToolCallEvent(IReadOnlyList<CoachToolCall> Calls) : CoachLiveServerEvent;

/// <summary>取消先前的 Function Call（<c>toolCallCancellation.ids[]</c>，通常因 barge-in）。</summary>
/// <param name="Ids">被取消的呼叫 Id 清單。</param>
public sealed record CoachToolCancelEvent(IReadOnlyList<string> Ids) : CoachLiveServerEvent;

/// <summary>連線即將關閉，需帶 handle 重連（<c>goAway.timeLeft</c>）。</summary>
/// <param name="TimeLeft">距關線的剩餘時間（protobuf Duration 的 JSON 字串，如 "8s"；可空）。</param>
public sealed record CoachGoAwayEvent(string? TimeLeft) : CoachLiveServerEvent;

/// <summary>滾動下發的可續用句柄（<c>sessionResumptionUpdate</c>）；上層據此持久化最後一個 handle。</summary>
/// <param name="NewHandle">新的續連句柄（可空）。</param>
/// <param name="Resumable">是否可續用（僅 true 時上層才持久化）。</param>
public sealed record CoachSessionResumptionUpdateEvent(string? NewHandle, bool Resumable) : CoachLiveServerEvent;

/// <summary>Token 計量事件（<c>usageMetadata</c>）；上層據此累計全站花費與續扣日用量（【審修-S1/S2】）。</summary>
/// <param name="TotalTokens">本次回報的總 token 數（<c>totalTokenCount</c>）。</param>
public sealed record CoachUsageMeteredEvent(long TotalTokens) : CoachLiveServerEvent;

/// <summary>
/// 連線已關閉（正常關、傳輸斷、或解析致命錯誤）。這是「一條連線」壽命的終點事件。
/// </summary>
/// <param name="Fatal">
/// 是否為不可回復的致命關閉（true＝解析例外／協定錯誤，上層應進 fatal 終態；
/// false＝一般傳輸斷線，上層可視情況帶 handle 重連）。
/// </param>
/// <param name="Reason">關閉原因（診斷用；可空）。</param>
public sealed record CoachClosedEvent(bool Fatal, string? Reason) : CoachLiveServerEvent;

/// <summary>
/// 共用 JSON 選項：Vertex Live 送出端 proto3 JSON 用 camelCase（接收端一律 camelCase）。
/// </summary>
internal static class CoachLiveJson
{
    /// <summary>送出訊息序列化用（camelCase、不寫 null）。</summary>
    public static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };
}
