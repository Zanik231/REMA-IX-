public class Program
{
    public record AnalyticsRequest(
        DateTime Start,
        DateTime End,
        string Interval,
        string Region
    );
    public static void Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);

        // Add services to the container.
        builder.Services.AddAuthorization();

        // Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
        builder.Services.AddOpenApi();

        var app = builder.Build();

        // Configure the HTTP request pipeline.
        if (app.Environment.IsDevelopment())
        {
            app.MapOpenApi();
        }

        app.UseHttpsRedirection();

        app.UseAuthorization();

        app.MapPost("/api/report/calculate", (AnalyticsRequest request) => {
            if ((request.End - request.Start).Ticks <= 0)
                return Results.BadRequest(new
                {
                    Message = "Конец периода не может быть больше начала!"
                });

            double averageValue = 42.5;
            double medianValue = 41.0;
            int announcementCount = 0;
            double minimumPerUnit = 41.0;
            double maximumPerUnit = 41.0;

            return Results.Ok(new
            {
                Average = averageValue,
                Median = medianValue,
                AnnouncementCount = announcementCount,
                MinimumPerUnit = minimumPerUnit,
                MaximumPerUnit = maximumPerUnit
            });
        });


    app.Run();
    }
}
