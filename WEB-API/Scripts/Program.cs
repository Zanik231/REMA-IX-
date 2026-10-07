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

        // Запрос главной страницы: список объявлений с фильтрами и пагинацией
        public record ListingsRequest(
            string? District,
            string? CategoryLand,
            string? Vri,
            decimal? AreaFrom,
            decimal? AreaTo,
            decimal? PriceFrom,
            decimal? PriceTo,
            string? Search,
            string? Sort = null,
            int Page = 1,
            int PageSize = 12
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

        // ─────────── Общие фильтры (используются и в отчётах, и в списках) ───────────

        private static IQueryable<LandPlotsReport> ApplyDistrictFilter(
            IQueryable<LandPlotsReport> query, string? district)
        {
            if (string.IsNullOrEmpty(district) || district == "Все районы")
                return query;

            // Совпадение по району или по населённому пункту («г. Томск»)
            return query.Where(p =>
                (p.District != null && EF.Functions.ILike(p.District, district)) ||
                (p.Locality != null && EF.Functions.ILike(p.Locality, district)));
        }

        private static IQueryable<LandPlotsReport> ApplyCategoryFilter(
            IQueryable<LandPlotsReport> query, string? categoryLand)
        {
            if (string.IsNullOrEmpty(categoryLand) || categoryLand == "Все категории")
                return query;

            // Если с фронта пришло «Земли сельхозназначения», ищем корень
            // «сельскохозяйственного», который есть в БД
            string catSearch = categoryLand == "Земли сельхозназначения"
                ? "сельскохозяйственного"
                : categoryLand.Replace("ё", "е");

            return query.Where(p =>
                EF.Functions.ILike(p.CategoryLand!.Replace("ё", "е"), $"%{catSearch}%"));
        }

        private static IQueryable<LandPlotsReport> ApplyVriFilter(
            IQueryable<LandPlotsReport> query, string? vri)
        {
            if (string.IsNullOrEmpty(vri) || vri == "Все виды" || vri == "Все ВРИ")
                return query;

            // Ключевое слово ВРИ, по которому ищем в колонке vri
            string vriSearch = vri switch
            {
                "Сельскохозяйственное использование" => "садоводство",
                "ИЖС" => "ИЖС",
                "ЛПХ" => "ЛПХ",
                _ => vri
            };

            return query.Where(p => EF.Functions.ILike(p.Vri!, $"%{vriSearch}%"));
        }

        // Медиана на отсортированном списке (середина для чётного количества)
        private static double MedianOf(List<double> sorted)
        {
            if (sorted.Count == 0) return 0;
            int mid = sorted.Count / 2;
            return sorted.Count % 2 == 1
                ? sorted[mid]
                : (sorted[mid - 1] + sorted[mid]) / 2.0;
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

            // В режиме разработки запрещаем кэшировать статику.
            // Без Cache-Control браузер применяет эвристическое правило
            // (10% от возраста файла) и может отдать недавно изменённые
            // index.html/script.js «со вчерашнего дня»: страница по адресу «/»
            // и по адресу «/index.html» при этом выглядит по-разному.
            var staticFiles = new StaticFileOptions
            {
                OnPrepareResponse = context =>
                {
                    if (app.Environment.IsDevelopment())
                    {
                        context.Context.Response.Headers.CacheControl = "no-cache";
                    }
                }
            };

            // UseDefaultFiles обязан стоять перед UseStaticFiles:
            // так «/» и «/report/.../» обрабатываются как обычные файлы,
            // а не через fallback.
            app.UseDefaultFiles();
            app.UseStaticFiles(staticFiles);
            app.MapFallbackToFile("index.html", staticFiles);

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
                double totalMedian = MedianOf(sortedCurrentPrices);

                // --- 3. Сводные метрики за прошлый год (Для дельты) ---
                int historyTotalCount = rawHistoryData.Count;
                double yearAgoMedian = 0;
                if (historyTotalCount > 0)
                {
                    var sortedHistoryPrices = rawHistoryData.Select(p => (double)p.PricePerUnit!.Value).OrderBy(v => v).ToList();
                    yearAgoMedian = MedianOf(sortedHistoryPrices);
                }

                double dynamicPriceDelta = yearAgoMedian > 0 ? Math.Round(((totalMedian - yearAgoMedian) / yearAgoMedian) * 100, 1) : 0.0;
                double dynamicCountDelta = historyTotalCount > 0 ? Math.Round(((double)(totalCount - historyTotalCount) / historyTotalCount) * 100, 1) : 0.0;

                // --- 4. Построение временной шкалы (Timeline) с помощью C# Группировки ---
                // Сортировка по числовому ключу (Год*100+Месяц/Квартал), иначе
                // «Q1 2026» лексикографически идёт раньше «Q4 2025»
                bool isQuarter = request.Interval == "По кварталам";

                var timeline = rawCurrentData
                    .GroupBy(p => new
                    {
                        Year = p.DatePublished!.Value.Year,
                        Bucket = isQuarter
                            ? (p.DatePublished.Value.Month - 1) / 3 + 1
                            : p.DatePublished.Value.Month
                    })
                    .Select(g => new
                    {
                        Period = isQuarter
                            ? $"Q{g.Key.Bucket} {g.Key.Year}"
                            : $"{g.Key.Year}-{g.Key.Bucket:00}",
                        SortKey = g.Key.Year * 100 + g.Key.Bucket,
                        AnnouncementCount = g.Count(),
                        Average = g.Average(p => (double)p.PricePerUnit!.Value),
                        Median = MedianOf(g.Select(p => (double)p.PricePerUnit!.Value)
                                           .OrderBy(v => v).ToList()),
                        MinimumPerUnit = g.Min(p => (double)p.PricePerUnit!.Value),
                        MaximumPerUnit = g.Max(p => (double)p.PricePerUnit!.Value)
                    })
                    .OrderBy(t => t.SortKey)
                    .Select(t => new
                    {
                        t.Period,
                        t.AnnouncementCount,
                        t.Average,
                        t.Median,
                        t.MinimumPerUnit,
                        t.MaximumPerUnit
                    })
                    .ToList();

                // --- 5. Построение исторической временной шкалы (HistoryTimeline) ---
                var historyTimeline = rawHistoryData
                    .GroupBy(p => new
                    {
                        Year = p.DatePublished!.Value.Year,
                        Bucket = isQuarter
                            ? (p.DatePublished.Value.Month - 1) / 3 + 1
                            : p.DatePublished.Value.Month
                    })
                    .Select(g => new
                    {
                        Period = isQuarter
                            ? $"Q{g.Key.Bucket} {g.Key.Year}"
                            : $"{g.Key.Year}-{g.Key.Bucket:00}",
                        SortKey = g.Key.Year * 100 + g.Key.Bucket,
                        AnnouncementCount = g.Count(),
                        Average = g.Average(p => (double)p.PricePerUnit!.Value),
                        Median = MedianOf(g.Select(p => (double)p.PricePerUnit!.Value)
                                           .OrderBy(v => v).ToList())
                    })
                    .OrderBy(t => t.SortKey)
                    .Select(t => new
                    {
                        t.Period,
                        t.AnnouncementCount,
                        t.Average,
                        t.Median
                    })
                    .ToList();

                // --- 6. Сегментация по площадям участка (AreaAnalytics) ---
                var areaSegments = rawCurrentData
                    .GroupBy(p =>
                    {
                        if (p.Area < 30) return "До 30 соток";
                        if (p.Area >= 30 && p.Area <= 50) return "От 30 до 50 соток";
                        return "Свыше 50 соток";
                    })
                    .Select(g =>
                    {
                        return new
                        {
                            SegmentGroup = g.Key,
                            AnnouncementCount = g.Count(),
                            Average = g.Average(p => (double)p.PricePerUnit!.Value),
                            Median = MedianOf(g.Select(p => (double)p.PricePerUnit!.Value)
                                               .OrderBy(v => v).ToList())
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

                // Общие фильтры (район/категория/ВРИ) — те же, что на главной
                query = ApplyDistrictFilter(query, request.District);
                query = ApplyCategoryFilter(query, request.CategoryLand);
                query = ApplyVriFilter(query, request.Vri);

                if (request.MinArea.HasValue) query = query.Where(p => p.Area >= request.MinArea.Value);
                if (request.MaxArea.HasValue) query = query.Where(p => p.Area <= request.MaxArea.Value);

                if (request.MinPricePerUnit.HasValue) query = query.Where(p => p.PricePerUnit >= request.MinPricePerUnit.Value);
                if (request.MaxPricePerUnit.HasValue) query = query.Where(p => p.PricePerUnit <= request.MaxPricePerUnit.Value);

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

            // ==========================================
            // ЭНДПОИНТ 4: СПИСОК ОБЪЯВЛЕНИЙ (ГЛАВНАЯ СТРАНИЦА)
            // Фильтры + поиск + сортировка по дате + пагинация
            // ==========================================
            app.MapPost("/api/listings", async (ListingsRequest request, ApplicationContext db) =>
            {
                var query = db.LandPlotsReports.AsQueryable();

                query = ApplyDistrictFilter(query, request.District);
                query = ApplyCategoryFilter(query, request.CategoryLand);
                query = ApplyVriFilter(query, request.Vri);

                if (request.AreaFrom.HasValue) query = query.Where(p => p.Area >= request.AreaFrom.Value);
                if (request.AreaTo.HasValue) query = query.Where(p => p.Area <= request.AreaTo.Value);
                if (request.PriceFrom.HasValue) query = query.Where(p => p.Price >= request.PriceFrom.Value);
                if (request.PriceTo.HasValue) query = query.Where(p => p.Price <= request.PriceTo.Value);

                if (!string.IsNullOrWhiteSpace(request.Search))
                {
                    string s = request.Search.Trim();
                    query = query.Where(p =>
                        (p.Address != null && EF.Functions.ILike(p.Address, $"%{s}%")) ||
                        (p.Locality != null && EF.Functions.ILike(p.Locality, $"%{s}%")) ||
                        (p.CadastralNumber != null && EF.Functions.ILike(p.CadastralNumber, $"%{s}%")) ||
                        (p.Description != null && EF.Functions.ILike(p.Description, $"%{s}%")));
                }

                int page = Math.Max(1, request.Page);
                int pageSize = Math.Clamp(request.PageSize, 1, 100);

                int total = await query.CountAsync();

                // Сортировку выполняем на сервере, а не на клиенте:
                // иначе пересортировываются только 12 карточек текущей
                // страницы и порядок «теряется» при переходе на следующую.
                // Объекты без цены/площади всегда уходят в конец списка.
                IOrderedQueryable<LandPlotsReport> ordered = request.Sort switch
                {
                    "price-asc" => query
                        .OrderBy(p => p.PricePerUnit == null ? 1 : 0)
                        .ThenBy(p => p.PricePerUnit),
                    "price-desc" => query
                        .OrderBy(p => p.PricePerUnit == null ? 1 : 0)
                        .ThenByDescending(p => p.PricePerUnit),
                    "area-asc" => query
                        .OrderBy(p => p.Area == null ? 1 : 0)
                        .ThenBy(p => p.Area),
                    "area-desc" => query
                        .OrderBy(p => p.Area == null ? 1 : 0)
                        .ThenByDescending(p => p.Area),
                    _ => query
                        .OrderByDescending(p => p.DatePublished)
                        .ThenByDescending(p => p.Id)
                };

                var items = await ordered
                    .Skip((page - 1) * pageSize)
                    .Take(pageSize)
                    .ToListAsync();

                return Results.Ok(new
                {
                    Total = total,
                    Page = page,
                    PageSize = pageSize,
                    Pages = (int)Math.Ceiling(total / (double)pageSize),
                    Items = items
                });
            });

            // ==========================================
            // ЭНДПОИНТ 5: СПРАВОЧНИКИ ДЛЯ ФИЛЬТРОВ (районы/населённые пункты)
            // ==========================================
            app.MapGet("/api/meta/filters", async (ApplicationContext db) =>
            {
                var districts = await db.LandPlotsReports
                    .Where(p => p.District != null && p.District != "")
                    .Select(p => p.District!)
                    .Distinct()
                    .OrderBy(d => d)
                    .ToListAsync();

                var localities = await db.LandPlotsReports
                    .Where(p => p.Locality != null && p.Locality != "")
                    .Select(p => p.Locality!)
                    .Distinct()
                    .OrderBy(d => d)
                    .ToListAsync();

                return Results.Ok(new { Districts = districts, Localities = localities });
            });

            app.Run();
        }

    }
}