"""Aesyr Studio Blender recipes.

Runs inside Blender (``blender -b --factory-startup --python recipes.py -- in.glb out.glb recipe.json``)
or with the ``bpy`` Python module (``python recipes.py in.glb out.glb recipe.json``).

Only fixed recipes run here. The recipe JSON is data validated by the app
(shared/motion.ts ``blenderRecipeSchema``); it never contains code.

Recipes: ``object-preset`` (spin, bob, hover, ...), ``keyframes`` (custom object motion),
``normalize`` (decimate + ground) and ``merge-clips`` (gather clips of one rig into one GLB).

Studio is Y-up metres; Blender is Z-up. A Studio vector (x, y, z) is Blender (x, -z, y),
matching the glTF importer/exporter. Keyframes are offsets from the asset's rest pose.

Output: the GLB with every clip it already had plus the new one, and ``<out>.json``
listing the clip names in the file.
"""

import json
import math
import sys

import bpy
from mathutils import Euler, Matrix, Vector

FPS = 30
C = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))  # Studio (Y-up) -> Blender (Z-up)


def studio_vec(v):
    return Vector((v[0], -v[2], v[1]))


def studio_rot(r):
    m = Euler((r[0], r[1], r[2]), "XYZ").to_matrix()
    return (C @ m @ C.transposed()).to_euler("XYZ")


def studio_scale(s):
    return Vector((s[0], s[2], s[1]))


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.unit_settings.system = "METRIC"


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def top_level(objects):
    return [o for o in objects if o.parent is None]


def bounds(objects):
    """World bounding box (Blender axes) of all mesh objects."""
    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    bpy.context.view_layer.update()
    for obj in objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            p = obj.matrix_world @ Vector(corner)
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
    if lo.x == math.inf:
        return Vector((-0.5, -0.5, 0)), Vector((0.5, 0.5, 1))
    return lo, hi


def make_root(objects, name="AesyrRoot"):
    """One empty at the asset's bottom-centre that owns object-level clips.

    If the file already has a single top-level object, reuse it so existing
    clips that target it stay valid.
    """
    tops = top_level(objects)
    if len(tops) == 1 and tops[0].type in {"EMPTY", "MESH", "ARMATURE"}:
        return tops[0]
    lo, hi = bounds(objects)
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    root.location = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    bpy.context.view_layer.update()
    for obj in tops:
        world = obj.matrix_world.copy()
        obj.parent = root
        obj.matrix_world = world
    return root


def existing_clips():
    return sorted({a.name for a in bpy.data.actions})


def unique(name):
    taken = {a.name.lower() for a in bpy.data.actions}
    candidate, n = name, 2
    while candidate.lower() in taken:
        candidate = f"{name} {n}"
        n += 1
    return candidate


def set_interpolation(action, kind):
    curves = list(getattr(action, "fcurves", []) or [])
    if not curves and hasattr(action, "layers"):
        for layer in action.layers:
            for strip in layer.strips:
                for bag in getattr(strip, "channelbags", []):
                    curves.extend(bag.fcurves)
    for curve in curves:
        for point in curve.keyframe_points:
            point.interpolation = kind


def fill_channels(keys):
    """Every channel used anywhere gets a value at every key.

    A key without a channel interpolates between its neighbours; before the first
    value it rests, after the last it holds. So "rotate at 0.5 s" never becomes a
    constant offset for the whole clip.
    """
    rest = {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}
    filled = [dict(k) for k in keys]
    for channel in rest:
        known = [(k["time"], k[channel]) for k in keys if channel in k]
        if not known:
            continue
        for key in filled:
            if channel in key:
                continue
            t = key["time"]
            before = [v for v in known if v[0] <= t]
            after = [v for v in known if v[0] >= t]
            if not before:
                a, b = (0.0, rest[channel]), after[0]
            elif not after:
                key[channel] = list(before[-1][1])
                continue
            else:
                a, b = before[-1], after[0]
            f = 0 if b[0] == a[0] else (t - a[0]) / (b[0] - a[0])
            key[channel] = [a[1][i] + (b[1][i] - a[1][i]) * f for i in range(3)]
    return filled


def write_clip(root, name, duration, loop, keys, linear=False):
    """Key the root from Studio-space offsets, then stash the action as its own NLA track.

    The root's rotation mode is left alone: clips imported from an earlier pass
    (often quaternions) must keep driving the same channels.
    """
    rest_loc = root.location.copy()
    rest_scale = root.scale.copy()
    mode = root.rotation_mode
    rest_q = root.matrix_basis.to_quaternion()
    saved_rotation = (root.rotation_quaternion.copy(), root.rotation_euler.copy(), tuple(root.rotation_axis_angle))
    if root.animation_data is None:
        root.animation_data_create()
    previous = root.animation_data.action
    clip = unique(name)
    action = bpy.data.actions.new(clip)
    root.animation_data.action = action
    euler = root.rotation_euler.copy()
    for key in fill_channels(keys):
        frame = round(key["time"] * FPS)
        if "position" in key:
            root.location = rest_loc + studio_vec(key["position"])
            root.keyframe_insert("location", frame=frame)
        if "rotation" in key:
            q = studio_rot(key["rotation"]).to_quaternion() @ rest_q
            if mode == "QUATERNION":
                root.rotation_quaternion = q
                root.keyframe_insert("rotation_quaternion", frame=frame)
            elif mode == "AXIS_ANGLE":
                axis, angle = q.to_axis_angle()
                root.rotation_axis_angle = (angle, axis.x, axis.y, axis.z)
                root.keyframe_insert("rotation_axis_angle", frame=frame)
            else:
                euler = q.to_euler(mode, euler)  # continuous with the previous key (full spins)
                root.rotation_euler = euler
                root.keyframe_insert("rotation_euler", frame=frame)
        if "scale" in key:
            s = studio_scale(key["scale"])
            root.scale = Vector((rest_scale.x * s.x, rest_scale.y * s.y, rest_scale.z * s.z))
            root.keyframe_insert("scale", frame=frame)
    set_interpolation(action, "LINEAR" if linear else "BEZIER")
    end = max(round(duration * FPS), 1)
    action.frame_range = (0, end)
    action.use_frame_range = True
    action["aesyr_loop"] = bool(loop)
    track = root.animation_data.nla_tracks.new()
    track.name = clip
    track.strips.new(clip, 0, action)
    track.mute = True  # exported by name, never blended into the rest pose
    root.animation_data.action = previous
    root.location, root.scale = rest_loc, rest_scale
    root.rotation_quaternion, root.rotation_euler, root.rotation_axis_angle = saved_rotation
    return clip


# ── Object presets: keys in Studio space (Y up, metres, radians) ─────────────


def hinge(angle_axis, angle, pivot):
    """Rotation about a pivot, expressed as rotation + translation offsets of the root."""
    m = Euler(angle_axis(angle), "XYZ").to_matrix()
    p = Vector(pivot)
    moved = p - m @ p
    return {"rotation": list(angle_axis(angle)), "position": [moved.x, moved.y, moved.z]}


def preset_keys(name, duration, size, axis, amount):
    w, h, d = size  # Studio x (width), y (height), z (depth)
    T = duration
    ax = {"x": 0, "y": 1, "z": 2}[axis or "y"]

    def rot(v):
        r = [0.0, 0.0, 0.0]
        r[ax] = v
        return r

    if name == "spin":
        n = amount or 1
        return [{"time": T * i / 4, "rotation": rot(2 * math.pi * n * i / 4)} for i in range(5)], True
    if name == "bob":
        a = amount or max(0.05, 0.08 * h)
        return [{"time": 0, "position": [0, 0, 0]}, {"time": T / 2, "position": [0, a, 0]}, {"time": T, "position": [0, 0, 0]}], False
    if name == "hover":
        a = amount or max(0.1, 0.15 * h)
        return [
            {"time": T * i / 8, "position": [0, a + 0.3 * a * math.sin(2 * math.pi * i / 8), 0]}
            for i in range(9)
        ], False
    if name == "sway":
        a = amount or 0.12
        return [{"time": 0, "rotation": [0, 0, 0]}, {"time": T / 4, "rotation": [0, 0, a]}, {"time": 3 * T / 4, "rotation": [0, 0, -a]}, {"time": T, "rotation": [0, 0, 0]}], False
    if name == "wobble":
        a = amount or 0.25
        return [{"time": T * i / 8, "rotation": [0, 0, a * math.exp(-i / 2.5) * math.cos(i * math.pi / 1.5)]} for i in range(9)], False
    if name == "pulse":
        a = 1 + (amount or 0.08)
        return [{"time": 0, "scale": [1, 1, 1]}, {"time": T / 2, "scale": [a, a, a]}, {"time": T, "scale": [1, 1, 1]}], False
    if name == "pop-in":
        return [
            {"time": 0, "scale": [0.01, 0.01, 0.01]},
            {"time": T * 0.7, "scale": [1.12, 1.12, 1.12]},
            {"time": T, "scale": [1, 1, 1]},
        ], False
    if name == "door-swing":
        open_angle = -(amount or math.radians(95))
        about_y = lambda a: (0, a, 0)
        return [dict(time=T * t, **hinge(about_y, open_angle * f, (-w / 2, 0, 0))) for t, f in [(0, 0), (0.6, 0.85), (1, 1)]], False
    if name == "lid-open":
        open_angle = -(amount or math.radians(110))
        about_x = lambda a: (a, 0, 0)
        return [dict(time=T * t, **hinge(about_x, open_angle * f, (0, h, -d / 2))) for t, f in [(0, 0), (0.7, 0.9), (1, 1)]], False
    if name == "fall-over":
        about_x = lambda a: (a, 0, 0)
        return [dict(time=T * t, **hinge(about_x, math.pi / 2 * f, (0, 0, d / 2))) for t, f in [(0, 0), (0.25, 0.08), (1, 1)]], False
    if name == "drive-forward":
        dist = amount or 3
        return [{"time": T * i / 6, "position": [0, 0.01 * (i % 2), dist * (i / 6) ** 1.4]} for i in range(7)], False
    raise ValueError(f"Unknown preset {name}")


def studio_size(objects):
    lo, hi = bounds(objects)
    size = hi - lo
    return (max(size.x, 0.01), max(size.z, 0.01), max(size.y, 0.01))


def normalize(objects, triangle_budget):
    meshes = [o for o in objects if o.type == "MESH"]
    triangles = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
    if triangles > triangle_budget:
        ratio = max(0.02, triangle_budget / triangles)
        for obj in meshes:
            if any(m.type == "ARMATURE" for m in obj.modifiers):
                continue  # keep skinned meshes intact
            mod = obj.modifiers.new("AesyrDecimate", "DECIMATE")
            mod.ratio = ratio
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.modifier_apply(modifier=mod.name)
    root = make_root(objects)
    lo, hi = bounds(objects)
    offset = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    root.location -= offset
    return root


def base_name(name):
    """Blender renames a re-imported "Armature" to "Armature.001"; match on the stem."""
    stem, dot, tail = name.rpartition(".")
    return stem if dot and tail.isdigit() else name


def stash_actions(obj):
    """Every action an object carries (its active action and its NLA strips), in order."""
    data = obj.animation_data
    if not data:
        return []
    found = []
    if data.action:
        found.append(data.action)
    for track in data.nla_tracks:
        for strip in track.strips:
            if strip.action and strip.action not in found:
                found.append(strip.action)
    return found


def add_track(obj, action, name):
    if obj.animation_data is None:
        obj.animation_data_create()
    action.name = "__aesyr_incoming__"  # so the action's own name never counts as taken
    clip = unique(name)
    action.name = clip
    track = obj.animation_data.nla_tracks.new()
    track.name = clip
    strip = track.strips.new(clip, int(action.frame_range[0]), action)
    # Blender 4.4+ (slotted actions): a strip on another object must point at the action's slot.
    slots = getattr(action, "slots", None)
    if slots and hasattr(strip, "action_slot") and strip.action_slot is None:
        strip.action_slot = slots[0]
    track.mute = True
    return clip


def merge_clips(base_objects, sources):
    """Copy the clips of other GLBs of the SAME rig onto this one (one character, many clips).

    Each source is {"path": local GLB, "name": optional clip name}. Objects are matched by
    name (Tripo retargets and UniMate motions keep the rig's object and bone names). A source
    whose clips match no object is an error, so a wrong rig never fails silently.
    """
    by_name = {}
    for obj in base_objects:
        by_name.setdefault(base_name(obj.name), obj)
    added = []
    for source in sources:
        imported = import_glb(source["path"])
        moved = 0
        for obj in imported:
            actions = stash_actions(obj)
            target = by_name.get(base_name(obj.name))
            if target is None and actions and base_name(obj.name) == "AesyrRoot":
                # an object clip made by an earlier recipe: give this model the same root
                obj.name = "AesyrRootIncoming"  # keep the plain name for this model's root
                target = by_name["AesyrRoot"] = make_root(base_objects)
                target.rotation_mode = obj.rotation_mode  # imported clips key quaternions
            if not actions or target is None or target.type != obj.type:
                continue
            if obj.animation_data:
                obj.animation_data.action = None
            for i, action in enumerate(actions):
                wanted = source.get("name") or base_name(action.name)
                if i and source.get("name"):
                    wanted = f"{source['name']} {i + 1}"
                added.append(add_track(target, action, wanted))
                moved += 1
        for obj in imported:
            bpy.data.objects.remove(obj, do_unlink=True)
        if not moved:
            raise ValueError(f"{source.get('name') or 'A clip file'} does not match this model's rig.")
    for mesh in [m for m in bpy.data.meshes if m.users == 0]:
        bpy.data.meshes.remove(mesh)
    return added


def export_glb(path):
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_force_sampling=True,
        export_frame_step=1,
        export_extras=True,
        export_lights=False,
        export_cameras=False,
        export_draco_mesh_compression_enable=False,
    )


def run(source, target, recipe):
    reset_scene()
    objects = import_glb(source)
    if not any(o.type == "MESH" for o in objects):
        raise ValueError("The model has no meshes.")
    # Imported clips arrive as stashed NLA tracks; make sure each is its own named track.
    for obj in objects:
        data = obj.animation_data
        if data and data.action and not any(t.name == data.action.name for t in data.nla_tracks):
            track = data.nla_tracks.new()
            track.name = data.action.name
            track.strips.new(data.action.name, int(data.action.frame_range[0]), data.action)
            track.mute = True
        if data:
            data.action = None
    kind = recipe["recipe"]
    if kind == "normalize":
        normalize(objects, int(recipe["triangleBudget"]))
    elif kind == "merge-clips":
        merge_clips(objects, recipe["sources"])
    else:
        root = make_root(objects)
        if kind == "object-preset":
            keys, linear = preset_keys(
                recipe["preset"], float(recipe["duration"]), studio_size(objects), recipe.get("axis"), recipe.get("amount")
            )
            write_clip(root, recipe["name"], float(recipe["duration"]), bool(recipe["loop"]), keys, linear)
        elif kind == "keyframes":
            write_clip(root, recipe["name"], float(recipe["duration"]), bool(recipe["loop"]), recipe["keys"])
        else:
            raise ValueError(f"Unknown recipe {kind}")
    export_glb(target)
    names = []
    for obj in bpy.data.objects:
        if obj.animation_data:
            names += [t.name for t in obj.animation_data.nla_tracks]
    with open(target + ".json", "w", encoding="utf-8") as handle:
        json.dump({"clips": sorted(set(names))}, handle)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    if len(argv) != 3:
        raise SystemExit("usage: recipes.py input.glb output.glb recipe.json")
    with open(argv[2], encoding="utf-8") as handle:
        run(argv[0], argv[1], json.load(handle))
