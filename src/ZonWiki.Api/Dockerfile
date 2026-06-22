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
COPY --from=build /app ./
EXPOSE 8080
ENTRYPOINT ["dotnet", "ZonWiki.Api.dll"]
