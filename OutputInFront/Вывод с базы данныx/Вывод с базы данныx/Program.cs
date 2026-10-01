using Вывод_с_базы_данныx;

var builder = WebApplication.CreateBuilder(args);

Dapper.DefaultTypeMap.MatchNamesWithUnderscores = true;

builder.Services.AddControllers();
builder.Services.AddScoped<AnnouncementRepository>();

var app = builder.Build();

app.UseDefaultFiles();   // сначала это
app.UseStaticFiles();    // потом это
app.MapControllers();

app.Run();
app.Run();