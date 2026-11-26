"""The hard safety rules. Pure functions over OSM tag dicts; no mode or setting can change them.

The TypeScript router implements the same rules, and both must pass every case in
safety/cases.json so the two can't drift apart. Where a rule is ambiguous, take the stricter
reading.
"""

from __future__ import annotations

from collections.abc import Mapping

Tags = Mapping[str, str]

# --- Way rules ---------------------------------------------------------------------------------

# Highway kinds a pedestrian may use with no further checks (beyond access, railway, etc.).
WALKABLE_HIGHWAYS = frozenset(
    {
        "footway",
        "path",
        "pedestrian",
        "steps",
        "corridor",
        "living_street",
        "track",
        "platform",
        "residential",
        "service",
        "unclassified",
        "tertiary",
        "tertiary_link",
        "secondary",
        "secondary_link",
        "primary",
        "primary_link",
    }
)

# Usable only with an explicit pedestrian permission (default foot access varies by country;
# in France pedestrians may not use cycleways by default).
NEEDS_FOOT_PERMISSION = frozenset({"cycleway", "bridleway"})

# Fast roads: only with foot=yes or a sidewalk mapped on the road itself.
FAST_ROADS = frozenset({"motorway", "motorway_link", "trunk", "trunk_link"})

FORBIDDEN_ACCESS = frozenset({"private", "no"})
FORBIDDEN_FOOT = frozenset({"no", "private", "use_sidepath"})
FOOT_PERMITTED = frozenset({"yes", "designated", "permissive"})
# Access is an allow-list: any other value (permit, military, emergency, delivery, discouraged,
# agricultural, unknown, a typo...) excludes the way unless foot access is explicitly given.
# customers and destination are kept deliberately (shop corridors, residential streets).
ACCESS_OK = frozenset({"yes", "permissive", "designated", "public", "destination", "customers"})
# foot likewise: only these values (or none) are walkable.
FOOT_OK = frozenset({"yes", "designated", "permissive", "official", "destination", "customers"})


def tag_values(tags: Tags, key: str) -> list[str]:
    """A tag's values, trimmed, lower-cased and split on ";" (each must pass: strictest wins)."""
    raw = tags.get(key)
    if raw is None:
        return []
    return [v.strip().lower() for v in raw.split(";") if v.strip()] or [""]


def access_refused(tags: Tags) -> str | None:
    """ "access" or "foot" if the way's or node's access tags rule out walking, else None.

    access=private|no excludes whatever foot says; any other value outside ACCESS_OK excludes
    unless foot is explicitly permitted. A foot value outside FOOT_OK always excludes.
    """
    foot = tag_values(tags, "foot")
    if any(v not in FOOT_OK for v in foot):
        return "foot"
    access = tag_values(tags, "access")
    if any(v in FORBIDDEN_ACCESS for v in access):
        return "access"
    foot_permitted = bool(foot) and all(v in FOOT_PERMITTED for v in foot)
    if any(v not in ACCESS_OK for v in access) and not foot_permitted:
        return "access"
    return None


SIDEWALK_PRESENT = frozenset({"both", "left", "right", "yes"})

# Mountain-grade paths aren't city walks.
OK_SAC_SCALES = frozenset({"hiking", "mountain_hiking"})
BAD_TRAIL_VISIBILITY = frozenset({"bad", "horrible", "no"})

# "Through a building" is only ever via these mapped public passages.
PASSAGE_TUNNEL = "building_passage"
PASSAGE_COVERED = "yes"
CORRIDOR_INDOOR = "corridor"


# Busy roads: where the sidewalks are mapped as their own ways, or there are none, nobody should
# be walking down the carriageway.
BUSY_CARRIAGEWAYS = frozenset(
    {"primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link"}
)


def sidewalks_mapped_separately(tags: Tags) -> bool:
    if tags.get("sidewalk") == "separate" or tags.get("sidewalk:both") == "separate":
        return True
    return tags.get("sidewalk:left") == "separate" and tags.get("sidewalk:right") == "separate"


def no_sidewalk(tags: Tags) -> bool:
    """No sidewalk on either side, however it's tagged."""
    if tags.get("sidewalk") in ("no", "none") or tags.get("sidewalk:both") in ("no", "none"):
        return True
    return tags.get("sidewalk:left") in ("no", "none") and tags.get("sidewalk:right") in (
        "no",
        "none",
    )


def has_mapped_sidewalk(tags: Tags) -> bool:
    if tags.get("sidewalk") in SIDEWALK_PRESENT:
        return True
    return any(tags.get(f"sidewalk:{side}") == "yes" for side in ("left", "right", "both"))


def way_exclusion(tags: Tags) -> str | None:
    """Return why a way must never be walked, or None if it's walkable.

    Order matters only for the reason reported; any matching rule excludes the way.
    """
    hw = tags.get("highway")
    if hw is None:
        return "not_highway"
    if "railway" in tags:
        return "railway"
    if hw in ("construction", "proposed") or "construction" in tags:
        return "construction"
    refused = access_refused(tags)
    if refused:
        return refused
    if tags.get("motorroad") == "yes" and tags.get("foot") not in FOOT_PERMITTED:
        return "motorroad"  # motorway rules: no pedestrians
    if (
        hw == "service"
        and tags.get("service") == "driveway"
        and tags.get("foot") not in FOOT_PERMITTED
        and tags.get("access") not in WAY_PUBLIC_ACCESS
    ):
        return "driveway"  # leads onto private property

    if hw in FAST_ROADS:
        if not (tags.get("foot") == "yes" or has_mapped_sidewalk(tags)):
            return "fast_road"
    elif hw in NEEDS_FOOT_PERMISSION:
        if tags.get("foot") not in FOOT_PERMITTED:
            return "no_foot_permission"
    elif hw not in WALKABLE_HIGHWAYS:
        return "highway_kind"

    if hw in BUSY_CARRIAGEWAYS and tags.get("foot") not in FOOT_PERMITTED:
        if sidewalks_mapped_separately(tags):
            return "sidewalk_separate"  # walk the mapped sidewalk, not the carriageway
        if no_sidewalk(tags):
            return "no_sidewalk"

    indoor = tags.get("indoor")
    if hw != "corridor" and indoor is not None and indoor not in ("no", CORRIDOR_INDOOR):
        # Inside a building but not a mapped corridor: never through a building otherwise.
        # highway=corridor qualifies whatever its indoor value.
        return "indoor_not_corridor"

    conveying = tags.get("conveying")
    if conveying is not None and conveying not in ("forward", "backward", "no"):
        # Escalator or moving walkway whose running direction isn't known.
        return "escalator_direction_unknown"

    sac = tags.get("sac_scale")
    if sac is not None and sac not in OK_SAC_SCALES:
        return "sac_scale"
    if tags.get("trail_visibility") in BAD_TRAIL_VISIBILITY:
        return "trail_visibility"
    return None


def is_building_passage(tags: Tags) -> bool:
    return tags.get("tunnel") == PASSAGE_TUNNEL


def is_covered(tags: Tags) -> bool:
    return tags.get("covered") == PASSAGE_COVERED


def is_indoor_corridor(tags: Tags) -> bool:
    return tags.get("highway") == "corridor" or tags.get("indoor") == CORRIDOR_INDOOR


def may_pass_through_building(tags: Tags) -> bool:
    """True if a walkable way may lie inside a building footprint.

    Mapped public passages (access=private/no is already excluded by way_exclusion), plus ways
    that are clearly on another level: tunnels below or bridges above.
    """
    if is_building_passage(tags) or is_covered(tags) or is_indoor_corridor(tags):
        return True
    return tags.get("tunnel") == "yes" or tags.get("bridge") not in (None, "no")


# A mapped passage or corridor isn't enough on its own: plenty run through homes, offices,
# universities and hospitals that the public can't use. Through any building that isn't
# public-facing, the way needs explicit public access, a street name, or a confirmation.
PUBLIC_BUILDINGS = frozenset(
    {"retail", "commercial", "mall", "supermarket", "kiosk", "train_station", "transportation",
     "public", "civic"}
)  # fmt: skip
PUBLIC_AREA_KINDS = frozenset({"mall", "station"})
PASSAGE_ACCESS_OK = frozenset({"yes", "permissive"})
PASSAGE_FOOT_OK = frozenset({"yes", "permissive", "designated", "customers"})


def passage_exclusion(
    tags: Tags,
    name: str,
    building: Mapping[str, str | None] | None,
    *,
    in_public_venue: bool = False,
    confirmed: bool = False,
) -> str | None:
    """Why a passage or corridor through `building` must not be used, or None.

    `building` is {"kind": area kind, "building": building tag} for the building the way runs
    through, or None if it's not inside one. Covered ways through a building count too: plenty
    are walkways through flats, offices and hospitals.
    """
    if building is None or not (
        is_building_passage(tags) or is_indoor_corridor(tags) or is_covered(tags)
    ):
        return None
    if confirmed or in_public_venue:
        return None
    if tags.get("access") in PASSAGE_ACCESS_OK or tags.get("foot") in PASSAGE_FOOT_OK:
        return None
    if building.get("kind") in PUBLIC_AREA_KINDS or building.get("building") in PUBLIC_BUILDINGS:
        return None
    # A named street or passage through a building is a public way; an unnamed corridor or
    # traboule may not be.
    if name and not is_indoor_corridor(tags) and "traboule" not in name.lower():
        return None
    return "passage_not_public"


# Ground the public can't enter. Military land is never walked, whatever its paths say. Prisons,
# construction sites, power plants and substations, and areas whose access isn't open to the
# public (private, no, permit, military, ...) only allow ways that are explicitly public. School
# grounds and golf courses are left walkable, deliberately.
WAY_PUBLIC_ACCESS = frozenset({"yes", "permissive"})
WAY_PUBLIC_FOOT = frozenset({"yes", "designated", "permissive"})
POWER_SITES = frozenset({"plant", "substation"})
# Set by the build on areas a city config lists as closed (see City.closed_areas); never in OSM.
CLOSED_SITE = "bd:closed"


def is_military_area(tags: Tags) -> bool:
    return tags.get("landuse") == "military" or tags.get("military") not in (None, "no")


def restricted_kind(tags: Tags) -> str | None:
    """What kind of closed ground an area is, or None if it's open."""
    if is_military_area(tags):
        return "military_area"
    if tags.get(CLOSED_SITE) == "yes":
        return "closed_site"
    if tags.get("amenity") == "prison":
        return "prison_area"
    if tags.get("landuse") == "construction":
        return "construction_area"
    if tags.get("power") in POWER_SITES:
        return "power_area"
    if any(v not in ACCESS_OK for v in tag_values(tags, "access")):
        return "restricted_area"
    return None


def is_restricted_area(tags: Tags) -> bool:
    return restricted_kind(tags) is not None


def restricted_area_exclusion(way_tags: Tags, area_tags: Tags) -> str | None:
    """Why a way inside this area must not be walked, or None."""
    kind = restricted_kind(area_tags)
    if kind is None or kind == "military_area":
        return kind
    if way_tags.get("access") in WAY_PUBLIC_ACCESS or way_tags.get("foot") in WAY_PUBLIC_FOOT:
        return None
    return kind


# Roads that may run under a building without a tunnel tag. Kept, but flagged and disclosed.
# Pedestrian ways inside a footprint are usually indoor routes, so they're not included.
UNDER_BUILDING_ROADS = frozenset(
    {
        "residential",
        "service",
        "unclassified",
        "living_street",
        "tertiary",
        "tertiary_link",
        "secondary",
        "secondary_link",
        "primary",
        "primary_link",
        "trunk",
        "trunk_link",
        "motorway",
        "motorway_link",
    }
)


def may_pass_under_building_unmapped(tags: Tags) -> bool:
    """True for a walkable road that lies inside a building footprint without a passage tag.

    These are almost always streets running under a building (an unmapped tunnel), so they're
    kept, flagged and disclosed to the walker rather than dropped. Anything that looks indoor
    (a level or indoor tag) is still dropped.
    """
    return (
        tags.get("highway") in UNDER_BUILDING_ROADS
        and "level" not in tags
        and tags.get("indoor") in (None, "no")
    )


def foot_directions(tags: Tags) -> tuple[bool, bool]:
    """Which directions (forward, backward along the way) a pedestrian may walk."""
    conveying = tags.get("conveying")
    if conveying == "forward":
        return True, False
    if conveying == "backward":
        return False, True

    oneway = tags.get("oneway:foot")
    if oneway is None and tags.get("highway") in (
        "footway",
        "path",
        "steps",
        "corridor",
        "pedestrian",
        "platform",
    ):
        # On pedestrian ways plain oneway applies to pedestrians; on roads it doesn't.
        oneway = tags.get("oneway")
    fwd = bwd = True
    if oneway == "yes":
        bwd = False
    elif oneway == "-1":
        fwd = False
    if tags.get("foot:forward") in FORBIDDEN_FOOT:
        fwd = False
    if tags.get("foot:backward") in FORBIDDEN_FOOT:
        bwd = False
    return fwd, bwd


# --- Node rules --------------------------------------------------------------------------------

# Mapped crossings. The tram values are OSM's tags for pedestrian and road crossings of tram
# tracks. Foot access is still checked by node_exclusion.
RAILWAY_CROSSINGS = frozenset(
    {"crossing", "level_crossing", "tram_crossing", "tram_level_crossing"}
)

# Railway features that aren't tracks; a node shared with them isn't a track crossing.
RAILWAY_NON_TRACK = frozenset(
    {
        "platform",
        "platform_edge",
        "station",
        "halt",
        "stop",
        "buffer_stop",
        "signal_box",
        "turntable",
        "traverser",
        # Entrances and stops aren't rails.
        "subway_entrance",
        "train_station_entrance",
        "funicular_entrance",
        "tram_stop",
    }
)

LINEAR_BARRIERS = frozenset(
    {"wall", "fence", "hedge", "retaining_wall", "city_wall", "guard_rail", "ditch"}
)
BARRIER_OPENINGS = frozenset(
    {
        "gate",
        "entrance",
        "opening",
        "lift_gate",
        "swing_gate",
        "kissing_gate",
        "stile",
        "turnstile",
        "bollard",
        "cycle_barrier",
        "full-height_turnstile",
        "hampshire_gate",
        "sliding_gate",
        "wicket_gate",
    }
)
CROSSING_HIGHWAY_NODES = frozenset({"crossing", "traffic_signals"})


def is_track_railway_way(tags: Tags) -> bool:
    """Railway ways that count as tracks for the crossing rule (strict: abandoned/disused too)."""
    rw = tags.get("railway")
    return rw is not None and rw not in RAILWAY_NON_TRACK


def is_linear_barrier_way(tags: Tags) -> bool:
    return tags.get("barrier") in LINEAR_BARRIERS


def node_exclusion(
    tags: Tags,
    *,
    on_railway: bool = False,
    on_fast_road: bool = False,
    on_linear_barrier: bool = False,
) -> str | None:
    """Return why a walking route must never pass through this node, or None.

    on_railway:        the node is shared with a railway track way
    on_fast_road:      the node is shared with an excluded motorway/trunk way
    on_linear_barrier: the node is shared with a wall/fence/hedge-type way
    """
    foot = tag_values(tags, "foot")
    if any(v not in FOOT_OK for v in foot):
        return "node_foot"
    foot_permitted = bool(foot) and all(v in FOOT_PERMITTED for v in foot)
    if any(v not in ACCESS_OK for v in tag_values(tags, "access")) and not foot_permitted:
        return "node_access"
    if tags.get("locked") == "yes":
        return "node_locked"
    if tags.get("crossing") == "no":
        return "node_crossing_no"

    if on_railway and tags.get("railway") not in RAILWAY_CROSSINGS:
        # Railways may only be crossed at mapped crossings with foot access (checked above).
        return "railway_unmapped_crossing"
    if on_fast_road and not (tags.get("highway") in CROSSING_HIGHWAY_NODES or "crossing" in tags):
        return "fast_road_unmarked_crossing"
    if on_linear_barrier and not (tags.get("barrier") in BARRIER_OPENINGS or "entrance" in tags):
        return "barrier_no_opening"
    return None


# --- Building footprints -----------------------------------------------------------------------

NOT_A_BUILDING = frozenset({"no", "roof", "canopy", "carport"})


def is_enclosed_building(tags: Tags) -> bool:
    """Building areas a route must not cut through (open roofs and canopies are fine)."""
    b = tags.get("building")
    if b is None or b in NOT_A_BUILDING:
        return False
    return not (tags.get("location") == "underground" or _layer(tags) < 0)


def _layer(tags: Tags) -> int:
    try:
        return int(tags.get("layer", "0"))
    except ValueError:
        return 0


def layer_of(tags: Tags) -> int:
    return _layer(tags)
