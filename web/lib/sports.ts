/**
 * Sports: results, fixtures, standings, news and injuries, live from ESPN's public JSON (CORS-enabled, no key).
 * One parser for every sport: an event has competitions (a match, a race, a tennis draw's matches), each with
 * competitors (teams, players or drivers). Sports ESPN doesn't cover (surf, climbing…) link to their official sites.
 */
export interface League { id: string; path: string; label: string; injuries?: boolean }
export interface Sport { id: string; label: string; icon: string; leagues: League[] }

export const SPORTS: Sport[] = [
  { id: "football", label: "Football", icon: "⚽", leagues: [
    { id: "fra.1", path: "soccer/fra.1", label: "Ligue 1" }, { id: "uefa.champions", path: "soccer/uefa.champions", label: "Champions League" },
    { id: "eng.1", path: "soccer/eng.1", label: "Premier League" }, { id: "esp.1", path: "soccer/esp.1", label: "LaLiga" },
    { id: "ita.1", path: "soccer/ita.1", label: "Serie A" }, { id: "ger.1", path: "soccer/ger.1", label: "Bundesliga" },
    { id: "uefa.europa", path: "soccer/uefa.europa", label: "Europa League" }, { id: "fra.2", path: "soccer/fra.2", label: "Ligue 2" },
    { id: "fifa.world", path: "soccer/fifa.world", label: "World Cup" },
  ] },
  { id: "basketball", label: "Basketball", icon: "🏀", leagues: [
    { id: "nba", path: "basketball/nba", label: "NBA", injuries: true }, { id: "wnba", path: "basketball/wnba", label: "WNBA", injuries: true },
  ] },
  { id: "tennis", label: "Tennis", icon: "🎾", leagues: [{ id: "atp", path: "tennis/atp", label: "ATP" }, { id: "wta", path: "tennis/wta", label: "WTA" }] },
  { id: "rugby", label: "Rugby", icon: "🏉", leagues: [
    { id: "top14", path: "rugby/270559", label: "Top 14" }, { id: "6n", path: "rugby/180659", label: "Six Nations" }, { id: "rwc", path: "rugby/164205", label: "World Cup" },
  ] },
  { id: "f1", label: "Formula 1", icon: "🏎️", leagues: [{ id: "f1", path: "racing/f1", label: "Formula 1" }] },
  { id: "mma", label: "MMA", icon: "🥊", leagues: [{ id: "ufc", path: "mma/ufc", label: "UFC" }] },
  { id: "golf", label: "Golf", icon: "⛳", leagues: [{ id: "pga", path: "golf/pga", label: "PGA Tour" }] },
  { id: "us", label: "US sports", icon: "🏈", leagues: [
    { id: "nfl", path: "football/nfl", label: "NFL", injuries: true }, { id: "nhl", path: "hockey/nhl", label: "NHL", injuries: true },
    { id: "mlb", path: "baseball/mlb", label: "MLB", injuries: true },
  ] },
  { id: "volleyball", label: "Volleyball", icon: "🏐", leagues: [{ id: "ncaa-m", path: "volleyball/mens-college-volleyball", label: "NCAA (men)" }] },
];

/** Sports with no open live feed: their official sites (results, rankings, calendars). */
export const ELSEWHERE: { label: string; icon: string; links: [string, string][] }[] = [
  { label: "Surf", icon: "🏄", links: [["WSL Championship Tour", "https://www.worldsurfleague.com/events"], ["WSL rankings", "https://www.worldsurfleague.com/athletes/tour/mct"]] },
  { label: "Climbing", icon: "🧗", links: [["IFSC results", "https://www.ifsc-climbing.org/events"], ["IFSC rankings", "https://www.ifsc-climbing.org/rankings"]] },
  { label: "Volleyball (pro)", icon: "🏐", links: [["Volleyball World", "https://en.volleyballworld.com/"], ["CEV (Europe)", "https://www.cev.eu/"]] },
  { label: "Cycling", icon: "🚴", links: [["UCI calendar", "https://www.uci.org/calendar"], ["ProCyclingStats", "https://www.procyclingstats.com/"]] },
  { label: "Handball", icon: "🤾", links: [["EHF Champions League", "https://www.eurohandball.com/en/competitions/ehf-champions-league/"], ["LNH Starligue", "https://www.lnh.fr/"]] },
  { label: "Athletics", icon: "🏃", links: [["World Athletics", "https://worldathletics.org/competitions"]] },
];

const API = "https://site.api.espn.com/apis";

export interface Side { id?: string; athlete?: boolean; name: string; short?: string; logo?: string; score?: string; winner?: boolean; home?: boolean; rank?: number; record?: string }
export interface Match {
  id: string;
  name: string;
  date: string;
  state: "pre" | "in" | "post";
  status: string;
  venue?: string;
  sides: Side[];
  odds?: string;
  note?: string;
  link?: string;
}

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function get(url: string): Promise<J> {
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`ESPN ${r.status}`);
  return r.json();
}

const ym = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;

/**
 * Results and fixtures from `from` to `to` days around today (e.g. -7..0 = the last week). ESPN refuses day
 * ranges for most sports but accepts whole months, so the months the window covers are fetched and filtered.
 */
export async function scoreboard(l: League, from = -3, to = 7): Promise<Match[]> {
  const a = new Date(Date.now() + from * 864e5);
  const b = new Date(Date.now() + to * 864e5);
  const months = [...new Set([ym(a), ym(new Date((a.getTime() + b.getTime()) / 2)), ym(b)])];
  const pages = await Promise.all(months.map((m) => get(`${API}/site/v2/sports/${l.path}/scoreboard?dates=${m}&limit=500`)));
  const seen = new Set<string>();
  const events = pages.flatMap((j) => j.events ?? []).filter((ev: J) => !seen.has(ev.id) && seen.add(ev.id));
  const out: Match[] = [];
  for (const ev of events) {
    const comps: J[] = ev.competitions?.length ? ev.competitions : (ev.groupings ?? []).flatMap((g: J) => g.competitions ?? []);
    for (const c of comps) {
      const st = c.status?.type ?? ev.status?.type ?? {};
      const sides: Side[] = (c.competitors ?? []).map((x: J) => ({
        id: x.team?.id ?? x.athlete?.id ?? x.id,
        athlete: !x.team && !!x.athlete,
        name: x.team?.displayName ?? x.athlete?.displayName ?? x.athlete?.fullName ?? "?",
        short: x.team?.abbreviation ?? x.athlete?.shortName,
        logo: x.team?.logo ?? x.athlete?.flag?.href ?? x.team?.logos?.[0]?.href,
        score: x.score?.displayValue ?? (typeof x.score === "string" ? x.score : undefined) ?? (x.linescores ?? []).map((s: J) => s.value).join(" "),
        winner: x.winner,
        home: x.homeAway === "home",
        rank: x.order ?? x.curatedRank?.current,
        record: x.records?.[0]?.summary,
      }));
      const o = c.odds?.[0];
      out.push({
        id: String(c.id ?? ev.id),
        name: comps.length > 1 ? `${ev.name ?? ev.shortName} · ${c.type?.abbreviation ?? c.round?.displayName ?? ""}`.replace(/ · $/, "") : ev.name ?? ev.shortName,
        date: c.date ?? ev.date,
        state: (st.state as Match["state"]) ?? "pre",
        status: st.shortDetail ?? st.description ?? "",
        venue: c.venue?.fullName ?? ev.venue?.displayName,
        sides: l.path.startsWith("racing") || l.path.startsWith("golf") ? sides.sort((p, q) => (p.rank ?? 99) - (q.rank ?? 99)).slice(0, 10) : sides,
        odds: o ? [o.details, o.overUnder ? `O/U ${o.overUnder}` : "", o.provider?.name ? `(${o.provider.name})` : ""].filter(Boolean).join(" ") : undefined,
        note: c.notes?.[0]?.headline,
        link: ev.links?.find((x: J) => x.rel?.includes("summary"))?.href ?? ev.links?.[0]?.href,
      });
    }
  }
  const lo = new Date(a.toDateString()).getTime();
  const hi = new Date(b.toDateString()).getTime() + 864e5;
  // a match in progress or a multi-day event (tennis draw, golf, race weekend) that started earlier still counts
  return out.filter((m) => { const t = Date.parse(m.date); return (t >= lo && t < hi) || m.state === "in"; }).sort((x, y) => x.date.localeCompare(y.date));
}

export interface Row { id?: string; athlete?: boolean; rank: number; team: string; logo?: string; played?: string; won?: string; drawn?: string; lost?: string; diff?: string; points?: string; note?: string }
export interface Table { name: string; rows: Row[] }

/** League tables (several for conferences / groups). */
export async function standings(l: League): Promise<Table[]> {
  const j = await get(`${API}/v2/sports/${l.path}/standings`);
  const groups: J[] = j.children?.length ? j.children : j.standings ? [j] : [];
  return groups.map((g) => {
    const entries: J[] = g.standings?.entries ?? [];
    const stat = (e: J, ...names: string[]) => e.stats?.find((s: J) => names.includes(s.name) || names.includes(s.abbreviation))?.displayValue;
    const rows = entries.map((e, i) => ({
      id: e.team?.id ?? e.athlete?.id,
      athlete: !e.team && !!e.athlete,
      rank: Number(stat(e, "rank") ?? i + 1),
      team: e.team?.displayName ?? e.athlete?.displayName ?? "?",
      logo: e.team?.logos?.[0]?.href,
      played: stat(e, "gamesPlayed", "GP"),
      won: stat(e, "wins", "W"),
      drawn: stat(e, "ties", "D", "T"),
      lost: stat(e, "losses", "L"),
      diff: stat(e, "pointDifferential", "differential", "GD", "pointDiff"),
      points: stat(e, "points", "P", "PTS") ?? stat(e, "winPercent", "PCT"),
      note: e.note?.description,
    })).sort((a, b) => a.rank - b.rank);
    return { name: g.name ?? g.abbreviation ?? "", rows };
  }).filter((t) => t.rows.length);
}

export interface News { title: string; text?: string; image?: string; url?: string; date?: string }
export async function news(l: League): Promise<News[]> {
  const j = await get(`${API}/site/v2/sports/${l.path}/news?limit=12`);
  return (j.articles ?? []).map((a: J) => ({ title: a.headline, text: a.description, image: a.images?.[0]?.url, url: a.links?.web?.href, date: a.published }));
}

export interface Injury { team: string; player: string; status: string; detail: string; date?: string }
export async function injuries(l: League): Promise<Injury[]> {
  if (!l.injuries) return [];
  const j = await get(`${API}/site/v2/sports/${l.path}/injuries`);
  return (j.injuries ?? []).flatMap((t: J) => (t.injuries ?? []).map((x: J) => ({
    team: t.displayName, player: x.athlete?.displayName ?? `${x.athlete?.firstName ?? ""} ${x.athlete?.lastName ?? ""}`.trim(),
    status: x.status, detail: x.shortComment ?? x.longComment ?? "", date: x.date,
  })));
}

// ------------------------------------------------------------------ one match in detail
export interface MatchEvent { minute: string; kind: "goal" | "yellow" | "red" | "sub" | "other"; team?: string; text: string; who?: string }
export interface StatLine { label: string; a: string; b: string; share?: number } // share: a's part of a+b, for the bar
export interface Lineup { team: string; teamId?: string; formation?: string; starters: { id?: string; n?: string; name: string; pos?: string }[]; bench: { id?: string; name: string }[] }
export interface Summary { events: MatchEvent[]; stats: StatLine[]; lineups: Lineup[]; teams: string[]; teamIds: (string | undefined)[]; link?: string; headline?: string; sides: Side[]; date?: string; status?: string; state?: Match["state"]; competition?: string; attendance?: number; venue?: string; form: { team: string; results: string }[]; leaders: { team: string; lines: string[] }[] }

const KEEP_STATS = /possession|shots|on goal|corner|fouls|offsides|saves|yellow|red|passes$|pass completion|tackles$|interceptions|field goal|three point|rebounds|assists|turnovers|steals|blocks|free throw|total yards|passing yards|rushing yards|first downs|penalties|hits|power play|faceoff/i;

export async function matchSummary(l: League, id: string): Promise<Summary> {
  const j: J = await get(`${API}/site/v2/sports/${l.path}/summary?event=${id}`);
  const teamsBox = (j.boxscore?.teams ?? []) as J[];
  const teams = teamsBox.map((t) => t.team?.displayName ?? "");
  const events: MatchEvent[] = ((j.keyEvents ?? j.scoringPlays ?? []) as J[]).flatMap((e) => {
    const t = String(e.type?.type ?? e.type?.text ?? "").toLowerCase();
    const kind: MatchEvent["kind"] = e.scoringPlay || t.includes("goal") ? "goal" : t.includes("yellow") ? "yellow" : t.includes("red") ? "red" : t.includes("substitution") ? "sub" : "other";
    if (kind === "other" && !e.scoringPlay) return [];
    const who = (e.participants ?? []).map((p: J) => p.athlete?.displayName).filter(Boolean);
    return [{
      minute: e.clock?.displayValue || (e.period?.number ? `P${e.period.number}` : ""), kind, team: e.team?.displayName,
      who: kind === "sub" ? who.join(" ↔ ") : who[0], text: e.shortText ?? e.text ?? "",
    }];
  });
  const stats: StatLine[] = [];
  if (teamsBox.length === 2) {
    const sa = (teamsBox[0].statistics ?? []) as J[], sb = (teamsBox[1].statistics ?? []) as J[];
    for (const s of sa) {
      const raw = String(s.label ?? s.name ?? "");
      const label = raw === raw.toUpperCase() ? raw.charAt(0) + raw.slice(1).toLowerCase() : raw; // "ON GOAL" -> "On goal"
      if (!KEEP_STATS.test(label)) continue;
      const o = sb.find((x) => x.name === s.name);
      if (!o) continue;
      let a = String(s.displayValue), b = String(o.displayValue);
      if (/%|completion/i.test(label) && +a <= 1 && +b <= 1) { a = `${Math.round(+a * 100)}%`; b = `${Math.round(+b * 100)}%`; }
      if (/possession/i.test(label)) { a = `${Math.round(+s.displayValue)}%`; b = `${Math.round(+o.displayValue)}%`; }
      const na = parseFloat(a), nb = parseFloat(b);
      stats.push({ label, a, b, share: na + nb > 0 ? na / (na + nb) : undefined });
    }
  }
  const lineups: Lineup[] = ((j.rosters ?? []) as J[]).map((r) => {
    const ro = (r.roster ?? []) as J[];
    return {
      team: r.team?.displayName ?? "", teamId: r.team?.id, formation: r.formation,
      starters: ro.filter((p) => p.starter).map((p) => ({ id: p.athlete?.id, n: p.jersey, name: p.athlete?.displayName ?? "", pos: p.position?.abbreviation })),
      bench: ro.filter((p) => !p.starter).map((p) => ({ id: p.athlete?.id, name: `${p.athlete?.displayName ?? ""}${p.subbedIn ? " ↑" : ""}` })),
    };
  }).filter((x) => x.starters.length);
  const form = ((j.lastFiveGames ?? []) as J[]).map((t) => ({
    team: t.team?.displayName ?? "",
    results: ((t.events ?? []) as J[]).map((ev) => String(ev.gameResult ?? "").slice(0, 1)).join(""),
  })).filter((f) => f.results);
  const leaders = ((j.leaders ?? []) as J[]).map((t) => ({
    team: t.team?.displayName ?? "",
    lines: ((t.leaders ?? []) as J[]).slice(0, 3).map((c) => `${c.displayName}: ${c.leaders?.[0]?.athlete?.displayName ?? ""} ${c.leaders?.[0]?.displayValue ?? ""}`.trim()),
  })).filter((x) => x.lines.length && x.team);
  const teamIds = teamsBox.map((t) => t.team?.id as string | undefined);
  const link = ((j.header?.links ?? []) as J[]).find((x) => x.rel?.includes("summary"))?.href ?? j.header?.links?.[0]?.href;
  const headline = j.article?.headline ?? j.header?.competitions?.[0]?.notes?.[0]?.headline;
  const hc: J = j.header?.competitions?.[0] ?? {};
  const sides: Side[] = ((hc.competitors ?? []) as J[]).map((x) => ({
    id: x.team?.id ?? x.athlete?.id ?? x.id, athlete: !x.team && !!x.athlete, name: x.team?.displayName ?? x.athlete?.displayName ?? "?",
    logo: x.team?.logos?.[0]?.href ?? x.team?.logo, score: x.score, winner: x.winner, home: x.homeAway === "home", record: x.record?.[0]?.summary,
  })).sort((p, q) => Number(q.home) - Number(p.home));
  const st: J = hc.status?.type ?? {};
  return { events, stats, lineups, teams, teamIds, link, headline, sides, date: hc.date, status: st.shortDetail ?? st.description, state: st.state, competition: j.header?.league?.name ?? j.header?.season?.name, attendance: j.gameInfo?.attendance || undefined, venue: j.gameInfo?.venue?.fullName, form, leaders };
}

// ------------------------------------------------------------------ teams and athletes
export const leagueById = (id: string | null): League | undefined => SPORTS.flatMap((s) => s.leagues).find((l) => l.id === id);
export const sportOf = (l: League): Sport => SPORTS.find((s) => s.leagues.includes(l))!;
export const teamHref = (l: League, id: string) => `/sports/team/?l=${encodeURIComponent(l.id)}&id=${encodeURIComponent(id)}`;
export const athleteHref = (l: League, id: string) => `/sports/athlete/?l=${encodeURIComponent(l.id)}&id=${encodeURIComponent(id)}`;
export const matchHref = (l: League, id: string) => `/sports/match/?l=${encodeURIComponent(l.id)}&id=${encodeURIComponent(id)}`;
/** Where a side of a match or a table row leads: its team page, or the athlete's page in tennis, golf, F1, MMA. */
export const sideHref = (l: League, s: { id?: string; athlete?: boolean }) => (s.id ? (s.athlete ? athleteHref(l, s.id) : teamHref(l, s.id)) : undefined);

export interface Player { id: string; name: string; jersey?: string; pos?: string; age?: number; nat?: string; photo?: string; height?: string; weight?: string; injured?: string }
export interface Game { id: string; date: string; opponent: string; opponentId?: string; opponentLogo?: string; home: boolean; done: boolean; score?: string; result?: "W" | "L" | "D"; venue?: string }
export interface Team {
  id: string; name: string; short?: string; logo?: string; color?: string; record?: string; standing?: string; season?: string;
  link?: string; coach: string[]; players: Player[]; games: Game[];
}

const posName = (p: J | undefined) => p?.displayName ?? p?.name;
const inches = (h?: number) => (h ? `${Math.round(h * 2.54)} cm` : undefined);
const pounds = (w?: number) => (w ? `${Math.round(w * 0.4536)} kg` : undefined);

/** A team: identity (from its roster page, which browsers may read), squad, coach and the season's games. */
export async function team(l: League, id: string): Promise<Team> {
  const [r, s] = await Promise.all([
    get(`${API}/site/v2/sports/${l.path}/teams/${id}/roster`),
    get(`${API}/site/v2/sports/${l.path}/teams/${id}/schedule`).catch(() => ({}) as J),
  ]);
  const t: J = r.team ?? s.team ?? {};
  // US leagues group the roster by position; football lists the athletes directly
  const raw: J[] = ((r.athletes ?? []) as J[]).flatMap((a) => (a.items ? (a.items as J[]) : [a]));
  const players: Player[] = raw.map((a) => ({
    id: String(a.id), name: a.displayName ?? a.fullName, jersey: a.jersey, pos: posName(a.position), age: a.age,
    nat: a.citizenship ?? a.birthPlace?.country, photo: a.headshot?.href, height: a.displayHeight ?? inches(a.height),
    weight: a.displayWeight ?? pounds(a.weight), injured: a.injuries?.[0]?.status,
  }));
  const games: Game[] = ((s.events ?? []) as J[]).map((ev) => {
    const c: J = ev.competitions?.[0] ?? {};
    const comps = (c.competitors ?? []) as J[];
    const me = comps.find((x) => String(x.id ?? x.team?.id) === String(id)) ?? {};
    const op = comps.find((x) => x !== me) ?? {};
    const sc = (x: J) => x.score?.displayValue ?? x.score?.value;
    const done = !!(c.status?.type?.completed || c.status?.type?.state === "post");
    const a = Number(sc(me)), b = Number(sc(op));
    return {
      id: String(ev.id), date: ev.date, opponent: op.team?.displayName ?? "?", opponentId: op.team?.id,
      opponentLogo: op.team?.logos?.[0]?.href ?? op.team?.logo, home: me.homeAway === "home", done,
      score: done && sc(me) != null ? `${sc(me)}–${sc(op)}` : undefined,
      result: done && !Number.isNaN(a) && !Number.isNaN(b) ? (a > b ? "W" : a < b ? "L" : "D") : undefined,
      venue: c.venue?.fullName,
    };
  });
  return {
    id: String(t.id ?? id), name: t.displayName ?? t.name ?? "", short: t.abbreviation, logo: t.logo ?? t.logos?.[0]?.href,
    color: t.color ? `#${t.color}` : undefined, record: t.recordSummary, standing: t.standingSummary, season: t.seasonSummary,
    link: t.clubhouse ?? t.links?.[0]?.href,
    coach: ((r.coach ?? []) as J[]).map((c) => `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim()).filter(Boolean),
    players, games,
  };
}

export interface Athlete {
  id: string; name: string; photo?: string; pos?: string; team?: { id?: string; name: string; logo?: string }; age?: number; born?: string;
  birthPlace?: string; nat?: string; flag?: string; height?: string; weight?: string; jersey?: string; status?: string; link?: string;
  stats: { label: string; value: string; hint?: string }[]; statsTitle?: string;
}

/** A player, driver or fighter: profile, current team and this season's numbers. */
export async function athlete(l: League, id: string): Promise<Athlete> {
  const j = await get(`https://site.web.api.espn.com/apis/common/v3/sports/${l.path}/athletes/${id}`);
  const a: J = j.athlete ?? {};
  const bp = a.birthPlace ? [a.birthPlace.city, a.birthPlace.state, a.birthPlace.country].filter(Boolean).join(", ") : undefined;
  return {
    id: String(a.id ?? id), name: a.displayName ?? a.fullName ?? "", photo: a.headshot?.href, pos: posName(a.position),
    team: a.team?.displayName || a.team?.name ? { id: a.team.id, name: a.team.displayName ?? a.team.name, logo: a.team.logos?.[0]?.href } : undefined,
    age: a.age, born: a.displayDOB, birthPlace: bp || undefined, nat: a.citizenship, flag: a.flag?.href, height: a.displayHeight, weight: a.displayWeight,
    jersey: a.displayJersey ?? a.jersey, status: a.status?.type ?? a.status?.name,
    link: ((a.links ?? []) as J[]).find((x) => x.rel?.includes("playercard"))?.href ?? a.links?.[0]?.href,
    statsTitle: a.statsSummary?.displayName,
    stats: ((a.statsSummary?.statistics ?? []) as J[]).map((x) => ({ label: x.displayName ?? x.name, value: x.displayValue ?? String(x.value), hint: x.description })),
  };
}
