// title: Blender in batch mode: count meshes and triangles
// title_es: Blender en lote: contar mallas y triángulos
// needs: blender
// Runs Python inside Blender without opening it. Change the scene path to one of your .blend files.

return await blender.run('C:/path/to/scene.blend', `
import bpy, json
deps = bpy.context.evaluated_depsgraph_get()
tris = 0
for o in bpy.context.scene.objects:
    if o.type == 'MESH':
        m = o.evaluated_get(deps).to_mesh()
        m.calc_loop_triangles()
        tris += len(m.loop_triangles)
        o.evaluated_get(deps).to_mesh_clear()
print(json.dumps({"objects": len(bpy.context.scene.objects), "triangles": tris}))
`)
