import fs from 'node:fs'; import sharp from 'sharp';
const f=process.argv[2], outDir=process.argv[3];
const buf=fs.readFileSync(f); let off=12,json=null,bin=null,total=buf.readUInt32LE(8);
while(off<total){const len=buf.readUInt32LE(off),t=buf.readUInt32LE(off+4);
 if(t===0x4E4F534A) json=JSON.parse(buf.slice(off+8,off+8+len).toString('utf8'));
 if(t===0x004E4942) bin=buf.slice(off+8,off+8+len); off+=8+len;}
for(const [i,im] of (json.images||[]).entries()){
  const bv=json.bufferViews[im.bufferView];
  const d=bin.slice(bv.byteOffset||0,(bv.byteOffset||0)+bv.byteLength);
  const m=await sharp(d).metadata();
  const o=`${outDir}/${f.split(/[\/]/).pop().replace('.glb','')}_${i}.png`;
  await sharp(d).resize(384,384,{fit:'inside'}).png().toFile(o);
  console.log(`[${i}] ${im.name} ${im.mimeType} ${m.width}x${m.height} -> ${o}`);
}
