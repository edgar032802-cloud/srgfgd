import fs from 'node:fs';
import sharp from 'sharp';
const f = process.argv[2];
const buf = fs.readFileSync(f);
let off=12,json=null,bin=null,total=buf.readUInt32LE(8);
while(off<total){const len=buf.readUInt32LE(off),t=buf.readUInt32LE(off+4);
  if(t===0x4E4F534A) json=JSON.parse(buf.slice(off+8,off+8+len).toString('utf8'));
  if(t===0x004E4942) bin=buf.slice(off+8,off+8+len); off+=8+len;}
for (const [i,im] of (json.images||[]).entries()){
  const bv=json.bufferViews[im.bufferView];
  const data=bin.slice(bv.byteOffset||0,(bv.byteOffset||0)+bv.byteLength);
  const out=`C:/Users/USER/AppData/Local/Temp/claude/C--Users-USER-Desktop----/ae87e9ed-2f27-4177-98eb-97b8c4998e5b/scratchpad/tex_${i}.${im.mimeType.split('/')[1]}`;
  fs.writeFileSync(out,data);
  try {
    const m = await sharp(data).metadata();
    console.log(`[${i}] ${im.name} ${im.mimeType} ${data.length}B ->`,
      JSON.stringify({w:m.width,h:m.height,ch:m.channels,space:m.space,depth:m.depth,icc:!!m.icc,fmt:m.format,hasAlpha:m.hasAlpha,isProgressive:m.isProgressive}));
    const r = await sharp(data).resize(256,256,{fit:'inside'}).webp({quality:90}).toBuffer();
    console.log(`     resize+webp OK ${r.length}B`);
  } catch(e){ console.log(`[${i}] ${im.name} SHARP FAIL:`, e.message); }
}
