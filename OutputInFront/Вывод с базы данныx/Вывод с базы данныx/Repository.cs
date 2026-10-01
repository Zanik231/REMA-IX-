using Вывод_с_базы_данныx.Models;
using Вывод_с_базы_данныx;
using Dapper;
using Npgsql;

public class AnnouncementRepository
{
    private readonly string _connString;

    public AnnouncementRepository(IConfiguration config)
        => _connString = config.GetConnectionString("Default")!;

    public async Task<PagedResult<AnnouncementData>> GetAsync(AnnouncementFilter f)
    {
        var where = new List<string>();
        var p = new DynamicParameters();

        if (!string.IsNullOrWhiteSpace(f.Region)) { where.Add("region = @Region"); p.Add("Region", f.Region); }
        if (!string.IsNullOrWhiteSpace(f.District)) { where.Add("district = @District"); p.Add("District", f.District); }
        if (!string.IsNullOrWhiteSpace(f.Locality)) { where.Add("locality = @Locality"); p.Add("Locality", f.Locality); }
        if (f.PriceFrom is not null) { where.Add("price >= @PriceFrom"); p.Add("PriceFrom", f.PriceFrom); }
        if (f.PriceTo is not null) { where.Add("price <= @PriceTo"); p.Add("PriceTo", f.PriceTo); }
        if (f.AreaFrom is not null) { where.Add("area >= @AreaFrom"); p.Add("AreaFrom", f.AreaFrom); }
        if (f.AreaTo is not null) { where.Add("area <= @AreaTo"); p.Add("AreaTo", f.AreaTo); }
        if (f.HasGas == true) where.Add("has_gas");
        if (f.HasElectricity == true) where.Add("has_electricity");
        if (f.HasWater == true) where.Add("has_water");
        if (f.HasHouse == true) where.Add("has_house");

        var whereSql = where.Count > 0 ? "WHERE " + string.Join(" AND ", where) : "";

        var pageSize = Math.Clamp(f.PageSize, 1, 200);
        var page = Math.Max(f.Page, 1);
        p.Add("Limit", pageSize);
        p.Add("Offset", (page - 1) * pageSize);

        var sql = $@"
            SELECT * FROM announcements {whereSql}
            ORDER BY date_published DESC, id DESC
            LIMIT @Limit OFFSET @Offset;

            SELECT COUNT(*) FROM announcements {whereSql};";

        await using var conn = new NpgsqlConnection(_connString);
        using var multi = await conn.QueryMultipleAsync(sql, p);
        var items = (await multi.ReadAsync<AnnouncementData>()).ToList();
        var total = await multi.ReadFirstAsync<int>();

        return new PagedResult<AnnouncementData>(items, total, page, pageSize);
    }

    public async Task<AnnouncementData?> GetByIdAsync(int id)
    {
        await using var conn = new NpgsqlConnection(_connString);
        return await conn.QueryFirstOrDefaultAsync<AnnouncementData>(
            "SELECT * FROM announcements WHERE id = @id", new { id });
    }

    // Для выпадающих списков на фронте
    public async Task<IEnumerable<string>> GetRegionsAsync()
    {
        await using var conn = new NpgsqlConnection(_connString);
        return await conn.QueryAsync<string>(
            "SELECT DISTINCT region FROM announcements WHERE region IS NOT NULL ORDER BY region");
    }
}