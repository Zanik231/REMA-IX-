namespace Вывод_с_базы_данныx;

public class AnnouncementFilter
{
    public string? Region { get; set; }
    public string? District { get; set; }
    public string? Locality { get; set; }
    public decimal? PriceFrom { get; set; }
    public decimal? PriceTo { get; set; }
    public decimal? AreaFrom { get; set; }
    public decimal? AreaTo { get; set; }
    public bool? HasGas { get; set; }
    public bool? HasElectricity { get; set; }
    public bool? HasWater { get; set; }
    public bool? HasHouse { get; set; }
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 50;
}

public record PagedResult<T>(IEnumerable<T> Items, int Total, int Page, int PageSize);
