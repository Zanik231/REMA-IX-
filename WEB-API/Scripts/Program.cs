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

        [Table("land_plots_report")]
        public class LandPlotsReport
        {
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

        // Вспомогательные классы для маппинга сложных SQL-ответов
        public class PeriodAnalyticsRow
        {
            public DateOnly PeriodStart { get; set; }
            public int AnnouncementCount { get; set; }
            public double Average { get; set; }
            public double Median { get; set; }
            public double MinimumPerUnit { get; set; }
            public double MaximumPerUnit { get; set; }
        }

        public class AreaSegmentRow
        {
            public string SegmentGroup { get; set; } = string.Empty;
            public int AnnouncementCount { get; set; }
            public double Average { get; set; }
            public double Median { get; set; }
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

            app.MapPost("/api/report/calculate", async (AnalyticsRequest request, ApplicationContext db) =>
            {
                // 1. Валидация периода времени
                if ((request.End - request.Start).Ticks <= 0)
                {
                    return Results.BadRequest(new { Message = "Конец периода не может быть меньше начала!" });
                }

                var startDate = DateOnly.FromDateTime(request.Start);
                var endDate = DateOnly.FromDateTime(request.End);

                // Период «Год назад» для сравнения (нижняя таблица на UI)
                var yearAgoStartDate = startDate.AddYears(-1);
                var yearAgoEndDate = endDate.AddYears(-1);

                // Определение интервала для date_trunc в PostgreSQL
                string dbInterval = request.Interval switch
                {
                    "По кварталам" => "quarter",
                    "По месяцам" => "month",
                    _ => "month"
                };

                // Базовый LINQ-запрос с фильтрацией по региону для общих вычислений
                var baseQuery = db.LandPlotsReports.Where(p =>
                    p.DatePublished >= startDate &&
                    p.DatePublished <= endDate &&
                    (string.IsNullOrEmpty(request.Region) || p.Region == request.Region));

                int totalCount = await baseQuery.CountAsync();
                if (totalCount == 0)
                {
                    return Results.Ok(new { Message = "Нет данных за выбранный период" });
                }

                // --- БЛОК 1: Карточки общего периода (Summary) ---
                double totalAverage = (double?)await baseQuery.AverageAsync(p => p.Price) ?? 0.0;

                var totalMedianResult = await db.Database.SqlQueryRaw<double?>(
                    @"SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY price)::float AS ""Value"" 
                    FROM land_plots_report 
                    WHERE date_published >= {0} AND date_published <= {1} AND ({2} = '' OR region = {2})",
                    startDate, endDate, request.Region ?? ""
                ).FirstOrDefaultAsync();
                double totalMedian = totalMedianResult ?? 0.0;


                // --- БЛОК 2: График и таблица детализации (Динамика стоимости по интервалам) ---
                // Вставляем dbInterval напрямую через {dbInterval}, а остальные параметры сдвигаем по индексам
                var rawTimeline = await db.Database.SqlQueryRaw<PeriodAnalyticsRow>(
                    $@"SELECT 
                    date_trunc('{dbInterval}', date_published)::date AS PeriodStart,
                    COUNT(*)::int AS AnnouncementCount,
                    COALESCE(AVG(price), 0)::float AS Average,
                    COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY price), 0)::float AS Median,
                    COALESCE(MIN(price_per_unit), 0)::float AS MinimumPerUnit,
                    COALESCE(MAX(price_per_unit), 0)::float AS MaximumPerUnit
                    FROM land_plots_report
                    WHERE date_published >= {{0}} AND date_published <= {{1}} AND ({{2}} = '' OR region = {{2}})
                    GROUP BY date_trunc('{dbInterval}', date_published)
                    ORDER BY PeriodStart",
                    startDate, endDate, request.Region ?? ""
                ).ToListAsync();

                // Форматируем вывод под фронтенд
                var timeline = rawTimeline.Select(row => new
                {
                    Period = dbInterval == "quarter"
                        ? $"{row.PeriodStart.Year} кв. {(row.PeriodStart.Month - 1) / 3 + 1}"
                        : row.PeriodStart.ToString("yyyy-MM"),
                    row.AnnouncementCount,
                    row.Average,
                    row.Median,
                    row.MinimumPerUnit,
                    row.MaximumPerUnit
                }).ToList();

                // --- БЛОК 3: Тот же период год назад (Сравнение) ---
                // Аналогично исправляем инъекцию интервала для исторического отчета
                var rawYearAgoTimeline = await db.Database.SqlQueryRaw<PeriodAnalyticsRow>(
                    $@"SELECT 
                    date_trunc('{dbInterval}', date_published)::date AS PeriodStart,
                    COUNT(*)::int AS AnnouncementCount,
                    COALESCE(AVG(price), 0)::float AS Average,
                    COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY price), 0)::float AS Median,
                    COALESCE(MIN(price_per_unit), 0)::float AS MinimumPerUnit,
                    COALESCE(MAX(price_per_unit), 0)::float AS MaximumPerUnit
                    FROM land_plots_report
                    WHERE date_published >= {{0}} AND date_published <= {{1}} AND ({{2}} = '' OR region = {{2}})
                    GROUP BY date_trunc('{dbInterval}', date_published)
                    ORDER BY PeriodStart",
                    yearAgoStartDate, yearAgoEndDate, request.Region ?? ""
                ).ToListAsync();

                var historyTimeline = rawYearAgoTimeline.Select(row => new
                {
                    Period = dbInterval == "quarter"
                        ? $"{row.PeriodStart.Year} кв. {(row.PeriodStart.Month - 1) / 3 + 1}"
                        : row.PeriodStart.ToString("yyyy-MM"),
                    row.AnnouncementCount,
                    row.Average,
                    row.Median
                }).ToList();


                // --- БЛОК 4: Сводка и распределение по площади участка (Сегменты) ---
                var areaSegments = await db.Database.SqlQueryRaw<AreaSegmentRow>(
                    @"SELECT 
                        CASE 
                            WHEN area < 20 THEN 'До 20 соток'
                            WHEN area >= 20 AND area <= 50 THEN 'От 20 до 50 соток'
                            ELSE 'Свыше 50 соток'
                        END AS SegmentGroup,
                        COUNT(*)::int AS AnnouncementCount,
                        COALESCE(AVG(price), 0)::float AS Average,
                        COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY price), 0)::float AS Median
                      FROM land_plots_report
                      WHERE date_published >= {0} AND date_published <= {1} AND ({2} = '' OR region = {2})
                      GROUP BY
                      CASE
                      WHEN area < 20 THEN 'До 20 соток'
                      WHEN area >= 20 AND area <= 50 THEN 'От 20 до 50 соток'
                      ELSE 'Свыше 50 соток'
                      END",
                startDate, endDate, request.Region ?? ""
                ).ToListAsync();
                // 5. Формируем единый комплексный ответ для дашборда
                return Results.Ok(new
                {
                    Summary = new
                    {
                        AveragePrice = totalAverage,
                        MedianPrice = totalMedian,
                        TotalAnnouncements = totalCount,
                        DynamicDeltaPercentage = 22.0 // Можно высчитать разницу с прошлым годом
                    },
                    Timeline = timeline,          // Сюда пойдут данные для Графика и Таблицы детализации
                    HistoryTimeline = historyTimeline,  // Для таблицы "Тот же период год назад"
                    AreaAnalytics = areaSegments   // Для блоков "Сводка по площади" и "Распределение"
                });
            });
            app.Run();
        }
    }
}