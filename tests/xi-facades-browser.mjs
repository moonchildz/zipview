import {chromium} from 'playwright';
import {PNG} from 'pngjs';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {mockGroundImagery} from './imagery-fixture.mjs';

const browser=await chromium.launch({channel:'chrome',headless:true});
await mkdir('verification',{recursive:true});
try {
  for(const width of [1000,390]) {
    const page=await browser.newPage({viewport:{width,height:700}});
    await mockGroundImagery(page);
    await page.goto('http://127.0.0.1:5174/?site=xi');
    await page.waitForSelector('#outlook-host[data-window-facade]');
    await page.waitForSelector('#outlook-host[data-imagery="visible"]');
    await page.evaluate(async()=>{
      const THREE=await import('/node_modules/three/build/three.module.js');
      const {applyXiLayoutHypothesis}=await import('/src/xi-unit-layout.js');
      const {xiFacadeSpec}=await import('/src/xi-window-facade.js');
      const {buildFacades}=await import('/src/facades.js');
      const data=await(await fetch('/research/gyeonghuigung-xi/scene.json')).json();
      const target=applyXiLayoutHypothesis(data);
      const scene=new THREE.Scene();scene.background=new THREE.Color('#eef1f2');
      scene.add(new THREE.HemisphereLight(0xffffff,0x667766,3));
      const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(70,120,60);scene.add(sun);
      for(const part of target.parts) {
        const shape=new THREE.Shape(part.points.map(([x,z])=>new THREE.Vector2(x,-z)));
        const geometry=new THREE.ExtrudeGeometry(shape,{depth:part.height,bevelEnabled:false});
        geometry.rotateX(-Math.PI/2);geometry.translate(0,part.base,0);
        scene.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:'#bbd5d3'})));
      }
      const facade=buildFacades(xiFacadeSpec(target,data.center));scene.add(facade);
      const halfHeight=38,halfWidth=Math.max(25,halfHeight*innerWidth/innerHeight);
      const camera=new THREE.OrthographicCamera(-halfWidth,halfWidth,halfHeight,-halfHeight,.1,500);
      const yaw=139*Math.PI/180;
      camera.position.set(Math.sin(yaw)*100,target.base+42,-Math.cos(yaw)*100);
      camera.lookAt(0,target.base+30,0);
      const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
      renderer.setSize(innerWidth,innerHeight);
      document.body.replaceChildren(renderer.domElement);
      document.body.style.cssText='margin:0;overflow:hidden';
      renderer.domElement.id='facade-verification';
      renderer.render(scene,camera);
      window.renderFacade=visible=>{facade.visible=visible;renderer.render(scene,camera);};
    });
    const canvas=page.locator('#facade-verification');
    const detailed=PNG.sync.read(await canvas.screenshot({path:`verification/xi-facade-exterior-${width}.png`}));
    await page.evaluate(()=>window.renderFacade(false));
    const plain=PNG.sync.read(await canvas.screenshot());
    let changed=0;
    for(let i=0;i<plain.data.length;i+=4) {
      if(Math.abs(plain.data[i]-detailed.data[i])+Math.abs(plain.data[i+1]-detailed.data[i+1])+Math.abs(plain.data[i+2]-detailed.data[i+2])>30)changed++;
    }
    assert.ok(changed>2000,`visible facade pixels: ${changed}`);
    console.log(JSON.stringify({width,changedFacadePixels:changed}));
    await page.close();
  }
} finally {await browser.close();}
