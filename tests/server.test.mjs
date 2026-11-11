import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPreviewServer } from '../server.mjs';

test('preview server handles requests and containment boundaries',async t=>{
  const base=await mkdtemp(path.join(tmpdir(),'pcb-server-'));
  assert.equal(path.dirname(base),tmpdir());
  const root=path.join(base,'public'),sibling=path.join(base,'public-other');
  await mkdir(root);await mkdir(sibling);
  await writeFile(path.join(root,'index.html'),'hello');await writeFile(path.join(sibling,'secret.txt'),'secret');
  await writeFile(path.join(root,'.hidden'),'hidden');
  await writeFile(path.join(root,'空 格.json'),'{}');
  await symlink(sibling,path.join(root,'linked'),'junction');
  const server=createPreviewServer({root});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(base,{recursive:true,force:true});});
  const request=(url,method='GET',headers={})=>new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port:server.address().port,path:url,method,headers},res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));
    });req.on('error',reject);req.end();
  });
  await t.test('GET and HEAD include correct content metadata',async()=>{
    const get=await request('/?v=1');assert.equal(get.status,200);assert.equal(get.body,'hello');assert.equal(get.headers['content-length'],'5');
    const head=await request('/','HEAD');assert.equal(head.status,200);assert.equal(head.body,'');assert.equal(head.headers.etag,get.headers.etag);
  });
  await t.test('conditional requests revalidate cached content',async()=>{
    const first=await request('/');assert.equal((await request('/','GET',{'If-None-Match':first.headers.etag})).status,304);
    await writeFile(path.join(root,'index.html'),'updated');assert.equal((await request('/','GET',{'If-None-Match':first.headers.etag})).body,'updated');
  });
  await t.test('malformed percent encoding does not crash subsequent requests',async()=>{
    for(const url of ['/%ZZ','/%E0%A4%A','/%00']) assert.equal((await request(url)).status,400);
    assert.equal((await request('/')).status,200);
  });
  await t.test('encoded traversal, sibling prefixes, dotfiles and junctions stay outside the public root',async()=>{
    for(const url of ['/../public-other/secret.txt','/%2e%2e/public-other/secret.txt','/..%5cpublic-other%5csecret.txt','/.hidden','/linked/secret.txt'])
      assert.equal((await request(url)).status,403,url);
  });
  await t.test('Unicode paths, missing files and disallowed methods have defined responses',async()=>{
    assert.equal((await request('/'+encodeURIComponent('空 格.json'))).body,'{}');
    assert.equal((await request('/missing')).status,404);assert.equal((await request('/','POST')).status,405);
  });
});
