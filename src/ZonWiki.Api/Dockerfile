# syntax=docker/dockerfile:1
# Build context is the repo's src/ folder (see docker-compose.yml: api.build.context).

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Restore as a separate layer so package restore is cached across source edits.
COPY ZonWiki.Api/ZonWiki.Api.csproj ZonWiki.Api/
COPY ZonWiki.Domain/ZonWiki.Domain.csproj ZonWiki.Domain/
COPY ZonWiki.Infrastructure/ZonWiki.Infrastructure.csproj ZonWiki.Infrastructure/
RUN dotnet restore ZonWiki.Api/ZonWiki.Api.csproj

COPY ZonWiki.Api/ ZonWiki.Api/
COPY ZonWiki.Domain/ ZonWiki.Domain/
COPY ZonWiki.Infrastructure/ ZonWiki.Infrastructure/
RUN dotnet publish ZonWiki.Api/ZonWiki.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

# 「精煉成筆記」需要的工具：ffmpeg（抽/轉音訊）、python3（yt-dlp 執行所需）、yt-dlp（抓字幕/下載音訊）。
# yt-dlp 取官方獨立執行檔放到 /usr/local/bin（PATH 上），後端以 "yt-dlp" 呼叫即可。
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates wget \
    && wget -q https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app ./
EXPOSE 8080
ENTRYPOINT ["dotnet", "ZonWiki.Api.dll"]
