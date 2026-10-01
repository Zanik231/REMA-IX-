using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations.Schema;

namespace Startup_Polygon_IX_Web_Api_.Scripts
{
    public class Program
    {
        public record AnalyticsRequest(
            DateTime Start,
            DateTime End,
            string Interval,
            string Region
        );

        public record AnalogSearchRequest(
            string? Region,
            string? District,
            decimal? MinArea,
            decimal? MaxArea,
            decimal? MinPricePerUnit,
            decimal? MaxPricePerUnit,
            string? CategoryLand,
            string? Vri
        );

        [Table("land_plots_report")]
        public class LandPlotsReport
        {
            [Column("id")]
            public int Id { get; set; }

            [Column("source")] public string? Source { get; set; }
            [Column("source_url")] public string? SourceUrl { get; set; }
            [Column("date_published")] public DateOnly? DatePublished { get; set; }
            [Column("parsed_at")] public DateTime? ParsedAt { get; set; }
            [Column("region")] public string? Region { get; set; }
            [Column("district")] public string? District { get; set; }
            [Column("locality")] public string? Locality { get; set; }
            [Column("address")] public string? Address { get; set; }
            [Column("price")] public decimal? Price { get; set; }
            [Column("price_per_unit")] public decimal? PricePerUnit { get; set; }
            [Column("area")] public decimal? Area { get; set; }
            [Column("area_unit")] public string? AreaUnit { get; set; }
            [Column("category_land")] public string? CategoryLand { get; set; }
            [Column("vri")] public string? Vri { get; set; }
            [Column("cadastral_number")] public string? CadastralNumber { get; set; }
            [Column("has_gas")] public bool? HasGas { get; set; }
            [Column("has_electricity")] public bool? HasElectricity { get; set; }
            [Column("has_water")] public bool? HasWater { get; set; }
            [Column("has_house")] public bool? HasHouse { get; set; }
            [Column("description")] public string? Description { get; set; }
            [Column("contact_name")] public string? ContactName { get; set; }
        }

        public class ApplicationContext : DbContext
        {
            public DbSet<LandPlotsReport> LandPlotsReports => Set<LandPlotsReport>();
            public ApplicationContext(DbContextOptions<ApplicationContext> options) : base(options) { }
        }

        public class MedianResult
        {
            public double? Value { get; set; }
        }

        public static void Main(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);
            builder.Services.AddAuthorization();

            string connection = builder.Configuration.GetConnectionString("DefaultConnection")!;
            builder.Services.AddDbContext<ApplicationContext>(options => options.UseNpgsql(connection));

            var app = builder.Build();

            app.UseHttpsRedirection();
            app.UseAuthorization();
            app.UseStaticFiles();
            app.UseDefaultFiles();
            app.MapFallbackToFile("index.html");

            app.MapGet("/api/hello_world{text_arg}", async (string text_arg) =>
            {
                return Results.Ok(new { Message = "Hello World! - " + text_arg });
            });

            // ==========================================
            // ЭНДПОИНТ 1: ПОЛНЫЙ РАСЧЕТ РЫНОЧНОЙ АНАЛИТИКИ (LINQ + Срезы)
            // ==========================================
            app.MapPost("/api/report/calculate", async (AnalyticsRequest request, ApplicationContext db) =>
            {
            if ((request.End - request.Start).Ticks <= 0)
            {
                return Results.BadRequest(new { Message = "Конец периода не может быть меньше начала!" });
            }

            var startDate = DateOnly.FromDateTime(request.Start);
            var endDate = DateOnly.FromDateTime(request.End);
            var yearAgoStartDate = startDate.AddYears(-1);
            var yearAgoEndDate = endDate.AddYears(-1);

            string loc = request.Region ?? "";

            // --- 1. Извлекаем сырые отфильтрованные данные в память приложения для быстрой C# аналитики ---
            var rawCurrentData = await db.LandPlotsReports
                .Where(p => p.DatePublished >= startDate && p.DatePublished <= endDate && p.PricePerUnit != null &&
                            (string.IsNullOrEmpty(loc) || p.Region == loc || p.District == loc || p.Locality == loc))
                .ToListAsync();

            var rawHistoryData = await db.LandPlotsReports
                .Where(p => p.DatePublished >= yearAgoStartDate && p.DatePublished <= yearAgoEndDate && p.PricePerUnit != null &&
                            (string.IsNullOrEmpty(loc) || p.Region == loc || p.District == loc || p.Locality == loc))
                .ToListAsync();

            int totalCount = rawCurrentData.Count;
            if (totalCount == 0)
            {
                return Results.Ok(new { Message = "Нет данных за выбранный период" });
            }

            // --- 2. Сводные метрики (Summary) за текущий год ---
            double totalAverage = rawCurrentData.Average(p => (double)p.PricePerUnit!.Value);

            var sortedCurrentPrices = rawCurrentData.Select(p => (double)p.PricePerUnit!.Value).OrderBy(v => v).ToList();
            double totalMedian = sortedCurrentPrices[totalCount / 2];

            // --- 3. Сводные метрики за прошлый год (Для дельты) ---
            int historyTotalCount = rawHistoryData.Count;
            double yearAgoMedian = 0;
            if (historyTotalCount > 0)
            {
                var sortedHistoryPrices = rawHistoryData.Select(p => (double)p.PricePerUnit!.Value).OrderBy(v => v).ToList();
                yearAgoMedian = sortedHistoryPrices[historyTotalCount / 2];
            }

            double dynamicPriceDelta = yearAgoMedian > 0 ? Math.Round(((totalMedian - yearAgoMedian) / yearAgoMedian) * 100, 1) : 0.0;
            double dynamicCountDelta = historyTotalCount > 0 ? Math.Round(((double)(totalCount - historyTotalCount) / historyTotalCount) * 100, 1) : 0.0;

            // --- 4. Построение временной шкалы (Timeline) с помощью C# Группировки ---
            bool isQuarter = request.Interval == "По кварталам";

            var timeline = rawCurrentData
                .GroupBy(p => isQuarter
                    ? $"Q{(p.DatePublished!.Value.Month - 1) / 3 + 1} {p.DatePublished.Value.Year}"
                    : p.DatePublished!.Value.ToString("yyyy-MM"))
                .Select(g => {
                    var sortedGroupPrices = g.Select(p => (double)p.PricePerUnit!.Value).OrderBy(v => v).ToList();
                    return new
                    {
                        Period = g.Key,
                        AnnouncementCount = g.Count(),
                        Average = g.Average(p => (double)p.PricePerUnit!.Value),
                        Median = sortedGroupPrices[sortedGroupPrices.Count / 2],
                        MinimumPerUnit = g.Min(p => (double)p.PricePerUnit!.Value),
                        MaximumPerUnit = g.Max(p => (double)p.PricePerUnit!.Value)
                    };
                })
                .OrderBy(t => t.Period)
                .ToList();

            // --- 5. Построение исторической временной шкалы (HistoryTimeline) ---
            var historyTimeline = rawHistoryData
                .GroupBy(p => isQuarter
                    ? $"Q{(p.DatePublished!.Value.Month - 1) / 3 + 1} {p.DatePublished.Value.Year}"
                    : p.DatePublished!.Value.ToString("yyyy-MM"))
                .Select(g => {
                    var sortedGroupPrices = g.Select(p => (double)p.PricePerUnit!.Value).OrderBy(v => v).ToList();
                    return new
                    {
                        Period = g.Key,
                        AnnouncementCount = g.Count(),
                        Average = g.Average(p => (double)p.PricePerUnit!.Value),
                        Median = sortedGroupPrices[sortedGroupPrices.Count / 2]
                    };
                })
                .OrderBy(t => t.Period)
                .ToList();

            // --- 6. Сегментация по площадям участка (AreaAnalytics) ---
            var areaSegments = rawCurrentData
                .GroupBy(p => {
                    if (p.Area < 30) return "До 30 соток";
                    if (p.Area >= 30 && p.Area <= 50) return "От 30 до 50 соток";
                    return "Свыше 50 соток";
                })
                .Select(g => {
                    var sortedGroupPrices = g.Select(p => (double)p.PricePerUnit!.Value).OrderBy(v => v).ToList();
                    return new
                    {
                        SegmentGroup = g.Key,
                        AnnouncementCount = g.Count(),
                        Average = g.Average(p => (double)p.PricePerUnit!.Value),
                        Median = sortedGroupPrices[sortedGroupPrices.Count / 2]
                    };
                })
                .ToList();

            return Results.Ok(new
            {
                Summary = new
                {
                    AveragePrice = totalAverage,
                    MedianPrice = totalMedian,
                    TotalAnnouncements = totalCount,
                    PriceChangeDeltaPercentage = dynamicPriceDelta,
                    CountChangeDeltaPercentage = dynamicCountDelta
                },
                Timeline = timeline,
                HistoryTimeline = historyTimeline,
                AreaAnalytics = areaSegments
            });
            });
            // ==========================================
            // ЭНДПОИНТ 2: ПОДБОР АНАЛОГОВ И ПОИСК
            // ==========================================
            app.MapPost("/api/analog/find", async (AnalogSearchRequest request, ApplicationContext db) =>
            {
                var query = db.LandPlotsReports.AsQueryable();

                if (!string.IsNullOrEmpty(request.Region))
                    query = query.Where(p => EF.Functions.ILike(p.Region!, request.Region));

                if (!string.IsNullOrEmpty(request.District) && request.District != "Все районы")
                    query = query.Where(p => EF.Functions.ILike(p.District!, request.District));

                if (request.MinArea.HasValue) query = query.Where(p => p.Area >= request.MinArea.Value);
                if (request.MaxArea.HasValue) query = query.Where(p => p.Area <= request.MaxArea.Value);

                if (request.MinPricePerUnit.HasValue) query = query.Where(p => p.PricePerUnit >= request.MinPricePerUnit.Value);
                if (request.MaxPricePerUnit.HasValue) query = query.Where(p => p.PricePerUnit <= request.MaxPricePerUnit.Value);

                // 5. Фильтр категории земель с нормализацией под CSV-базу
                if (!string.IsNullOrEmpty(request.CategoryLand) && request.CategoryLand != "Все категории")
                {
                    // Если с фронта пришло "Земли сельхозназначения", преобразуем в корень "сельскохозяйственного", который есть в БД
                    string catSearch = request.CategoryLand == "Земли сельхозназначения"
                        ? "сельскохозяйственного"
                        : request.CategoryLand.Replace("ё", "е");

                    query = query.Where(p => EF.Functions.ILike(p.CategoryLand!.Replace("ё", "е"), $"%{catSearch}%"));
                }

                // 6. Фильтр ВРИ с нормализацией под CSV-базу
                if (!string.IsNullOrEmpty(request.Vri) && request.Vri != "Все виды" && request.Vri != "Все ВРИ")
                {
                    // Если с фронта пришло "Сельскохозяйственное использование", ищем ключевое слово "садоводство" или "ЛПХ"
                    string vriSearch = request.Vri switch
                    {
                        "Сельскохозяйственное использование" => "садоводство",
                        "ИЖС" => "ИЖС",
                        "ЛПХ" => "ЛПХ",
                        _ => request.Vri
                    };

                    query = query.Where(p => EF.Functions.ILike(p.Vri!, $"%{vriSearch}%"));
                }

                var analogs = await query.OrderByDescending(p => p.DatePublished).Take(100).ToListAsync();
                return Results.Ok(analogs);
            });
            // ==========================================
            // ЭНДПОИНТ 3: ПОЛУЧЕНИЕ КОЛИЧЕСТВА ОБЪЯВЛЕНИЙ В БАЗЕ
            // ==========================================
            app.MapGet("/api/report/total-count", async (ApplicationContext db) =>
            {
                int total = await db.LandPlotsReports.CountAsync();
                return Results.Ok(new { Total = total });
            });

            app.Run();
        }

    }
}