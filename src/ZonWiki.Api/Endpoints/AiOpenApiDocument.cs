namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 給「ChatGPT Custom GPT Action」用的<b>精簡、策展過</b>的 OpenAPI 文件。
///
/// 為何不直接用內建 <c>AddOpenApi()</c> 自動產生的完整文件：
/// 自動文件會列出全站「所有」端點（龐大且雜訊多），ChatGPT 的 Action 反而難用、也容易超出限制。
/// 這裡只精選「AI 助理整理筆記」真正需要的幾個端點，並宣告 Bearer 安全方案，貼上即可用。
///
/// 安全方案：<c>bearerAuth</c>（HTTP Bearer）。在 ChatGPT 的 Action 設定中選「API Key／Bearer」，
/// 貼上使用者於個人頁產生的 ZonWiki API 權杖（PAT）即可。
/// </summary>
public static class AiOpenApiDocument
{
    /// <summary>
    /// 建立 OpenAPI JSON 文件字串。
    /// </summary>
    /// <param name="serverUrl">API 對外基底位址（例如 https://zonwiki.pee-yang.com）。會填入 servers 欄位。</param>
    /// <returns>OpenAPI 3.1.0 JSON 字串。</returns>
    public static string Build(string serverUrl)
    {
        // 以 {{SERVER_URL}} 佔位再取代，避免在原樣字串中處理大量大括號跳脫。
        return Template.Replace("{{SERVER_URL}}", serverUrl);
    }

    /// <summary>
    /// OpenAPI 文件樣板（伺服器位址以佔位符表示）。
    /// </summary>
    private const string Template = """
{
  "openapi": "3.1.0",
  "info": {
    "title": "ZonWiki AI 整合 API",
    "description": "讓 AI 助理把整理好的內容寫成 ZonWiki 筆記並正確歸類（資料夾名稱→巢狀分類、Markdown→筆記）。所有請求需以 Authorization: Bearer <ZonWiki API 權杖> 驗證。",
    "version": "1.0.0"
  },
  "servers": [
    { "url": "{{SERVER_URL}}", "description": "ZonWiki API" }
  ],
  "security": [
    { "bearerAuth": [] }
  ],
  "paths": {
    "/api/ai/notes": {
      "post": {
        "operationId": "createClassifiedNote",
        "summary": "建立（或更新）一篇筆記並自動歸類",
        "description": "把標題與 Markdown 內容寫成一篇筆記。categoryPath 以名稱由上而下指定分類路徑（找不到會自動建立巢狀分類），tags 以名稱指定標籤（找不到會自動建立）。upsert=true 時，同分類同標題會更新而非新增。",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/AiCreateNoteRequest" }
            }
          }
        },
        "responses": {
          "200": {
            "description": "建立或更新成功",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/AiCreateNoteResponse" }
              }
            }
          },
          "401": { "description": "未提供或無效的 API 權杖" }
        }
      }
    },
    "/api/categories": {
      "get": {
        "operationId": "listCategories",
        "summary": "列出所有分類",
        "description": "取得目前使用者的分類清單（含階層與每個分類的筆記數）。AI 可先看一遍，盡量沿用既有分類名稱、避免建立語意重複的新分類。",
        "responses": {
          "200": {
            "description": "分類清單",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/CategoryListResponse" }
              }
            }
          },
          "401": { "description": "未提供或無效的 API 權杖" }
        }
      }
    },
    "/api/notes": {
      "get": {
        "operationId": "listNotes",
        "summary": "列出筆記",
        "description": "取得目前使用者的筆記摘要清單，可用 categoryId 篩選某分類底下的筆記。",
        "parameters": [
          {
            "name": "categoryId",
            "in": "query",
            "required": false,
            "description": "只列出此分類底下的筆記（分類 GUID）",
            "schema": { "type": "string" }
          }
        ],
        "responses": {
          "200": {
            "description": "筆記摘要清單",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/NoteListResponse" }
              }
            }
          },
          "401": { "description": "未提供或無效的 API 權杖" }
        }
      }
    }
  },
  "components": {
    "securitySchemes": {
      "bearerAuth": {
        "type": "http",
        "scheme": "bearer",
        "description": "ZonWiki 個人存取權杖（在個人頁 → API 權杖 產生）"
      }
    },
    "schemas": {
      "AiCreateNoteRequest": {
        "type": "object",
        "required": ["title"],
        "properties": {
          "title": { "type": "string", "description": "筆記標題" },
          "contentRaw": { "type": "string", "description": "Markdown 內容" },
          "categoryPath": {
            "type": "array",
            "items": { "type": "string" },
            "description": "分類名稱路徑（由上而下），例如 [\"學習\",\"Python\"]。找不到會自動建立巢狀分類。"
          },
          "tags": {
            "type": "array",
            "items": { "type": "string" },
            "description": "標籤名稱清單；找不到會自動建立。"
          },
          "upsert": {
            "type": "boolean",
            "description": "true＝同分類同標題就更新、不新增（避免重複）。預設 false。"
          }
        }
      },
      "AiCreateNoteResponse": {
        "type": "object",
        "properties": {
          "success": { "type": "boolean" },
          "data": {
            "type": "object",
            "properties": {
              "id": { "type": "string" },
              "title": { "type": "string" },
              "slug": { "type": "string" },
              "categoryId": { "type": "string", "nullable": true },
              "categoryPath": { "type": "array", "items": { "type": "string" } },
              "created": { "type": "boolean", "description": "true＝新建；false＝更新既有" }
            }
          },
          "error": { "type": "string", "nullable": true }
        }
      },
      "CategoryListResponse": {
        "type": "object",
        "properties": {
          "success": { "type": "boolean" },
          "data": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": { "type": "string" },
                "parentId": { "type": "string", "nullable": true },
                "name": { "type": "string" },
                "noteCount": { "type": "integer" }
              }
            }
          }
        }
      },
      "NoteListResponse": {
        "type": "object",
        "properties": {
          "success": { "type": "boolean" },
          "data": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": { "type": "string" },
                "title": { "type": "string" },
                "slug": { "type": "string" }
              }
            }
          }
        }
      }
    }
  }
}
""";
}
