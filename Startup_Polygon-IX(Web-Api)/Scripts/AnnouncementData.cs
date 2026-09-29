public class AnnouncementData
{
    public int Id { get; set; }
    public string Source { get; set; }
    public string SourceUrl { get; set; }
    public DateOnly DatePublished { get; set; }
    public DateTime ParsedAt { get; set; }
    public String Region { get; set; }
    public String District { get; set; }
    public String Locality { get; set; }
    public String Address { get; set; }
    public decimal Price { get; set; }
    public decimal PricePerUnit { get; set; }
    public decimal Area { get; set; }
    public decimal AreaUnit { get; set; }
    public string CategoryLand { get; set; }
    public string Vri { get; set; }
    public string CadastralNumber { get; set; }
    public bool HasGas { get; set; }
    public bool HasElectricity { get; set; }
    public bool HasWater { get; set; }
    public bool HasHouse { get; set; }
    public string Description { get; set; }
    public string ContactName { get; set; }
}
//id — номер строки, проставляется сам
//source — источник: avito или cian
//source_url — ссылка на объявление
//date_published — дата публикации (ГГГГ-ММ-ДД)
//parsed_at — когда спарсили (дата+время)
//region — регион, например Томская
//district — район, например Асиновский район
//locality — город/посёлок, например Ново-Кусково
//address — адрес целиком: Ново - Кусково, ул.Молодёжная, 24
//price — цена в рублях, например 511000
//price_per_unit — цена за сотку, например 42583.30 (это и есть «ср. цена» в отчёте)
//area — площадь, например 12.00
//area_unit — единица площади, всегда сотка
//category_land — категория: Земли населённых пунктов или Земли сельхозназначения
//vri — вид использования: ИЖС, ЛПХ, Садоводство, Фермерское хозяйство
//cadastral_number — кадастровый номер, например 70:13:061982:2029
//has_gas — газ есть? True/False
//has_electricity — свет есть? True/False
//has_water — вода есть? True/False
//has_house — дом есть? True/False
//description — текст объявления как есть
//contact_name — имя продавца, например Наталья

//цена, размер(гектары,сотки), ср цена за сотку