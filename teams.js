// Teams shown in the "My Teams" catalog.
//
// To add a team, find it on espn.com. The URL holds the league and team id, e.g.
//   https://www.espn.com/nba/team/_/name/no/new-orleans-pelicans  -> sport basketball, league nba
//   https://www.espn.com/soccer/club/_/id/360/manchester-united    -> sport soccer, league eng.1, id 360
// For US leagues, the numeric id is in this list:
//   https://site.api.espn.com/apis/site/v2/sports/<sport>/<league>/teams
//
// `search` is the text used by the "Search Stremio" button.
module.exports = [
  { slug: 'pelicans', sport: 'basketball', league: 'nba', id: '3', search: 'Pelicans' },
  { slug: 'saints', sport: 'football', league: 'nfl', id: '18', search: 'Saints' },
  { slug: 'manutd', sport: 'soccer', league: 'eng.1', id: '360', search: 'Manchester United' },
];
