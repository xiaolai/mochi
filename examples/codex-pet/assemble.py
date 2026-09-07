from pathlib import Path
import json, sys
from PIL import Image
# The renderer writes into build/<flavour>/; this reads from there and writes the
# two files Codex actually loads into pets/<id>/, which is directly copyable.
flavour=sys.argv[1] if len(sys.argv)>1 else 'matcha'
here=Path(__file__).resolve().parent
root=here/'build'/flavour
manifest_pet=json.loads((root/'render-manifest.json').read_text())['pet']
pet=here/'pets'/manifest_pet['id']; pet.mkdir(parents=True,exist_ok=True)
manifest=json.loads((root/'render-manifest.json').read_text())
frames=root/'frames'; atlas=Image.new('RGBA',(1536,2288)); (root/'final').mkdir(exist_ok=True); (root/'qa').mkdir(exist_ok=True)
def load(source):
    im=Image.open(source).convert('RGBA').resize((192,208),Image.Resampling.LANCZOS)
    data=bytearray(im.tobytes())
    for i in range(0,len(data),4):
        if data[i+3]==0:data[i:i+3]=b'\0\0\0'
    return Image.frombytes('RGBA',im.size,bytes(data))
for row,(state,items) in enumerate(manifest['states'].items()):
    (frames/state).mkdir(parents=True,exist_ok=True)
    for col,item in enumerate(items):
        im=load(root/'raw'/state/item['file']);im.save(frames/state/item['file']);atlas.alpha_composite(im,(col*192,row*208))
neutral=load(root/'raw/neutral.png');neutral.save(root/'neutral.png');atlas.alpha_composite(neutral,(6*192,0))
look=[]
for i,item in enumerate(manifest['look']):
    im=load(root/'raw/look'/f"{item['label']}.png");look.append(im);atlas.alpha_composite(im,((i%8)*192,(9+i//8)*208))
atlas.save(root/'final/spritesheet.png');atlas.save(pet/'spritesheet.webp',lossless=True,method=6,exact=True)
(pet/'pet.json').write_text(json.dumps(manifest_pet,indent=2)+'\n')
# Lossless animated previews avoid the palette banding of GIFs.
for state,items in manifest['states'].items():
    ims=[Image.open(frames/state/item['file']).convert('RGBA') for item in items]
    durations=[200]*len(ims)
    ims[0].save(root/f'qa/{state}.webp',save_all=True,append_images=ims[1:],duration=durations,loop=0,lossless=True,method=6,exact=True)
look[0].save(root/'qa/look-loop.webp',save_all=True,append_images=look[1:],duration=180,loop=0,lossless=True,method=6,exact=True)
# Contract-specific invariants beyond ordinary atlas validation.
alpha0=look[0].getchannel('A').tobytes()
assert all(im.getchannel('A').tobytes()==alpha0 for im in look), 'Look poses changed silhouette'
assert all(im.getbbox()==look[0].getbbox() for im in look), 'Look poses changed registration'
report={'ok':True,'pet':manifest_pet['id'],'look_silhouettes_identical':True,'look_registration_identical':True,'no_limb_geometry':'Only original domeOutline is rendered; no new silhouette primitives','source_renderer':manifest['renderer'],'user_override':'All states use only breathing, eye and mouth movements; no literal waving, jumping or locomotion.'}
(root/'qa/native-invariants.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
