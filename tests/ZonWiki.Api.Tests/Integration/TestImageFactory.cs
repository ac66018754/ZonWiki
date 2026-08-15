using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Bmp;
using SixLabors.ImageSharp.Formats.Gif;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.Formats.Tiff;
using SixLabors.ImageSharp.Metadata.Profiles.Exif;
using SixLabors.ImageSharp.PixelFormats;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 測試影像產生器：在記憶體中生成各種格式/尺寸/特徵的圖片位元組，
/// 讓附件端點測試不需要把二進位檔簽入 repo。
/// </summary>
public static class TestImageFactory
{
    /// <summary>
    /// 生成純色 PNG。
    /// </summary>
    /// <param name="width">寬（像素）。</param>
    /// <param name="height">高（像素）。</param>
    /// <returns>PNG 位元組。</returns>
    public static byte[] CreatePng(int width = 64, int height = 48)
    {
        using var image = new Image<Rgba32>(width, height, new Rgba32(200, 100, 50));
        using var stream = new MemoryStream();
        image.Save(stream, new PngEncoder());
        return stream.ToArray();
    }

    /// <summary>
    /// 生成純色 GIF（單幀；驗證「gif 原樣保存」用）。
    /// </summary>
    /// <param name="width">寬（像素）。</param>
    /// <param name="height">高（像素）。</param>
    /// <returns>GIF 位元組。</returns>
    public static byte[] CreateGif(int width = 32, int height = 32)
    {
        using var image = new Image<Rgba32>(width, height, new Rgba32(10, 200, 10));
        using var stream = new MemoryStream();
        image.Save(stream, new GifEncoder());
        return stream.ToArray();
    }

    /// <summary>
    /// 生成「超過 10MB」的 BMP（BMP 無壓縮：寬×高×每像素位元組數，可精準控制體積）。
    /// 2200×2200×32bpp ≈ 19MB，必超過正式預設的 10MB 單檔上限。
    /// </summary>
    /// <returns>超大 BMP 位元組。</returns>
    public static byte[] CreateOversizedBmp()
    {
        using var image = new Image<Rgba32>(2200, 2200, new Rgba32(1, 2, 3));
        using var stream = new MemoryStream();
        image.Save(stream, new BmpEncoder { BitsPerPixel = BmpBitsPerPixel.Pixel32 });
        return stream.ToArray();
    }

    /// <summary>
    /// 生成帶 EXIF Orientation=6（需順時針轉 90°）的 JPEG。
    /// 上傳流程若正確 AutoOrient，落地後的寬高會與原始像素寬高「對調」。
    /// </summary>
    /// <param name="width">原始像素寬。</param>
    /// <param name="height">原始像素高。</param>
    /// <returns>JPEG 位元組。</returns>
    public static byte[] CreateJpegWithExifOrientation6(int width = 300, int height = 200)
    {
        using var image = new Image<Rgba32>(width, height, new Rgba32(60, 60, 220));
        image.Metadata.ExifProfile = new ExifProfile();
        image.Metadata.ExifProfile.SetValue(ExifTag.Orientation, (ushort)6);
        using var stream = new MemoryStream();
        image.Save(stream, new JpegEncoder());
        return stream.ToArray();
    }

    /// <summary>
    /// 生成 TIFF（合法影像、但不在附件格式白名單內 → 應被拒收）。
    /// </summary>
    /// <returns>TIFF 位元組。</returns>
    public static byte[] CreateTiff()
    {
        using var image = new Image<Rgba32>(16, 16, new Rgba32(5, 5, 5));
        using var stream = new MemoryStream();
        image.Save(stream, new TiffEncoder());
        return stream.ToArray();
    }

    /// <summary>
    /// 生成超高像素但檔案很小的 PNG（純色高壓縮）：驗證「解碼前像素上限」防解壓縮炸彈。
    /// 7000×7000 = 49MP，超過預設 24MP 上限；純色 PNG 實際檔案僅數十 KB。
    /// </summary>
    /// <returns>高像素 PNG 位元組。</returns>
    public static byte[] CreateDecompressionBombPng()
    {
        using var image = new Image<Rgba32>(7000, 7000, new Rgba32(255, 255, 255));
        using var stream = new MemoryStream();
        image.Save(stream, new PngEncoder());
        return stream.ToArray();
    }

    /// <summary>
    /// 以 ImageSharp 解碼位元組並回傳（格式名稱, 寬, 高），供斷言落地內容。
    /// </summary>
    /// <param name="bytes">影像位元組。</param>
    /// <returns>格式名稱（如 Webp/Gif）、寬、高。</returns>
    public static (string FormatName, int Width, int Height) Inspect(byte[] bytes)
    {
        using var stream = new MemoryStream(bytes, writable: false);
        var info = Image.Identify(stream);
        return (info.Metadata.DecodedImageFormat?.Name ?? "?", info.Width, info.Height);
    }
}
