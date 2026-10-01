using Вывод_с_базы_данныx;
using Microsoft.AspNetCore.Mvc;

[ApiController]
[Route("api/[controller]")]
public class AnnouncementsController : ControllerBase
{
    private readonly AnnouncementRepository _repo;
    public AnnouncementsController(AnnouncementRepository repo) => _repo = repo;

    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] AnnouncementFilter filter)
        => Ok(await _repo.GetAsync(filter));

    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById(int id)
    {
        var item = await _repo.GetByIdAsync(id);
        return item is null ? NotFound() : Ok(item);
    }

    [HttpGet("regions")]
    public async Task<IActionResult> Regions()
        => Ok(await _repo.GetRegionsAsync());
}
