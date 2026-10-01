using Вывод_с_базы_данныx.Models;
public class AnnouncementData
{
    public int Id { get; set; }
    public string Source { get; set; } = "";
    public string SourceUrl { get; set; } = "";
    public DateOnly DatePublished { get; set; }
    public DateTime ParsedAt { get; set; }
    public string? Region { get; set; }
    public string? District { get; set; }
    public string? Locality { get; set; }
    public string? Address { get; set; }
    public decimal? Price { get; set; }
    public decimal? PricePerUnit { get; set; }
    public decimal? Area { get; set; }
    public decimal? AreaUnit { get; set; }
    public string? CategoryLand { get; set; }
    public string? Vri { get; set; }
    public string? CadastralNumber { get; set; }
    public bool HasGas { get; set; }
    public bool HasElectricity { get; set; }
    public bool HasWater { get; set; }
    public bool HasHouse { get; set; }
    public string? Description { get; set; }
    public string? ContactName { get; set; }
}