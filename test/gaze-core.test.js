/* gaze-core.js 시험. 카메라 없이 가짜 얼굴 랜드마크로 돌립니다.
   실행: node test/gaze-core.test.js */
"use strict";
var assert=require("assert");
var G=require("../gaze-core.js");

var VW=640,VH=480,F=VW/2/Math.tan(Math.PI/6);
var passed=0,failed=0;
function test(name,fn){
  try{fn();passed++;console.log("  통과  "+name);}
  catch(err){failed++;console.log("  실패  "+name+"\n        "+(err&&err.message));}
}
function rng(seed){
  var a=seed>>>0;
  return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};
}
function gauss(r){return Math.sqrt(-2*Math.log(r()+1e-12))*Math.cos(2*Math.PI*r())}

/* 가짜 얼굴. 좌표는 "뒤집은 화면" 기준으로 만들고, 카메라가 주는 것처럼 다시 뒤집어 돌려줍니다.
   o: gx, gy 보는 곳(0~1), cx, cy 얼굴 위치(0~1), distCm, closed 눈 감김(0~1), noise 홍채 떨림(px), rnd, shift 홍채 치우침 */
function fakeFace(o){
  o=o||{};
  var gx=o.gx==null?0.5:o.gx,gy=o.gy==null?0.5:o.gy,cx=(o.cx==null?0.5:o.cx)*VW,cy=(o.cy==null?0.5:o.cy)*VH;
  var irisPx=F*1.17/(o.distCm||50),iod=irisPx*63/11.7,w=irisPx*28/11.7,closed=o.closed||0;
  var lm=[],i;
  function set(i,x,y){lm[i]={x:1-x/VW,y:y/VH,z:0}}
  for(i=0;i<478;i++)set(i,cx,cy);
  set(10,cx,cy-1.0*iod);set(152,cx,cy+1.3*iod);set(234,cx-0.9*iod,cy);set(454,cx+0.9*iod,cy);
  set(1,cx,cy+0.55*iod);
  function eye(e,ex,rightEye){
    var nx=o.noise?gauss(o.rnd)*o.noise:0,ny=o.noise?gauss(o.rnd)*o.noise:0;
    var ix=ex+((gx-0.5)*0.3+(o.shift||0))*w+nx,iy=cy+(gy-0.5)*0.2*w+ny,r=irisPx/2;
    set(e.outer,rightEye?ex+w/2:ex-w/2,cy);set(e.inner,rightEye?ex-w/2:ex+w/2,cy);
    set(e.up,ex,cy-0.15*w*(1-closed)+(gy-0.5)*0.1*w);set(e.low,ex,cy+0.15*w*(1-closed));
    set(e.iris,ix,iy);
    set(e.ring[0],ix+r,iy);set(e.ring[1],ix,iy-r);set(e.ring[2],ix-r,iy);set(e.ring[3],ix,iy+r);
  }
  eye(G.EYE.R,cx+iod/2,true);eye(G.EYE.L,cx-iod/2,false);
  return lm;
}
function meas(o){
  o=o||{};
  return G.measure(fakeFace(o),{vw:VW,vh:VH,matrix:o.matrix||null,blink:{l:o.closed||0,r:o.closed||0}});
}
/* 9칸을 차례로 보게 해서 보정 모델을 만듭니다. */
function calibrate(o){
  var r=rng(7),samples=[],t=0,ms=[];
  for(var z=1;z<=9;z++){
    var c=G.zoneCenter(z),col=new G.Collector();
    col.start(t);
    for(var n=0;n<400&&!col.done();n++){
      t+=33;
      var a={gx:c.x,gy:c.y,noise:0.15,rnd:r};
      for(var k in o)a[k]=o[k];
      col.update(meas(a),0,t);
    }
    assert.ok(col.done(),"칸 "+z+" 표본이 채워져야 합니다");
    col.buf.forEach(function(s){samples.push({f:s.f,x:c.x,y:c.y});ms.push(s.m);});
  }
  var model=G.ridgeFit(samples);
  assert.ok(model,"회귀 모델이 만들어져야 합니다");
  return {model:model,ms:ms,t:t};
}
function near(a,b,tol,msg){assert.ok(Math.abs(a-b)<=tol,(msg||"")+" 기대 "+b+" ±"+tol+", 실제 "+a)}

console.log("측정");
test("거리, 두 눈, 얼굴 위치를 구한다",function(){
  var m=meas({distCm:50});
  near(m.distCm,50,1,"거리");
  assert.strictEqual(m.eyes,2);
  near(m.ex,0.5,0.01);near(m.ey,0.5,0.01);
  near(m.roll,0,1,"기울임");
  assert.strictEqual(m.cut,false);
  near(meas({distCm:80}).distCm,80,2,"먼 거리");
});
test("전면 카메라의 좌우 뒤집힘을 맞춘다",function(){
  var lm=fakeFace({gx:1}),m=G.measure(lm,{vw:VW,vh:VH});
  assert.ok(lm[468].x<lm[33].x+0.5,"가짜 얼굴 확인");
  assert.ok(m.hx>0,"화면 오른쪽을 보면 hx가 양수여야 합니다: "+m.hx);
  assert.ok(G.measure(fakeFace({gx:0}),{vw:VW,vh:VH}).hx<0);
  assert.ok(G.measure(fakeFace({gy:1}),{vw:VW,vh:VH}).hy>0,"아래를 보면 hy가 양수");
  /* 얼굴이 카메라 영상의 왼쪽에 찍히면, 뒤집은 화면에서는 오른쪽 */
  var raw=fakeFace({cx:0.8});
  assert.ok(raw[1].x<0.5);
  assert.ok(G.measure(raw,{vw:VW,vh:VH}).ex>0.5);
});
test("얼굴이 잘리면 알아챈다",function(){
  assert.strictEqual(meas({cx:0.02}).cut,true);
  assert.strictEqual(G.measure(null,{vw:VW,vh:VH}),null);
  assert.strictEqual(G.measure([],{vw:VW,vh:VH}),null);
});
test("변환 행렬에서 머리 각도를 구한다(열 우선, 행 우선 모두)",function(){
  var a=20*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  var col=[c,0,-s,0, 0,1,0,0, s,0,c,0, 1,2,-50,1];
  var row=[c,0,s,1, 0,1,0,2, -s,0,c,-50, 0,0,0,1];
  var A=G.anglesOf(col),B=G.anglesOf(row),I=G.anglesOf([1,0,0,0,0,1,0,0,0,0,1,0,0,0,-50,1]);
  near(Math.abs(A.yaw),20,0.01,"열 우선 좌우");near(A.pitch,0,0.01);near(A.roll,0,0.01);
  near(B.yaw,A.yaw,0.01,"행 우선도 같은 값");
  near(I.yaw,0,0.01);near(I.pitch,0,0.01);near(I.roll,0,0.01);
  assert.strictEqual(G.anglesOf(null),null);
  var b=30*Math.PI/180,rollM=[Math.cos(b),Math.sin(b),0,0,-Math.sin(b),Math.cos(b),0,0,0,0,1,0,0,0,-50,1];
  near(Math.abs(G.anglesOf(rollM).roll),30,0.01,"기울임");
});
test("한쪽 눈이 좁게 찍히면 그 눈만 쓴다",function(){
  var lm=fakeFace({gx:0.5}),e=G.EYE.L;
  /* 왼쪽 눈 너비를 40%로 줄임 */
  var mid=(lm[e.outer].x+lm[e.inner].x)/2;
  [e.outer,e.inner].forEach(function(i){lm[i].x=mid+(lm[i].x-mid)*0.4});
  var m=G.measure(lm,{vw:VW,vh:VH,blink:{l:0.9,r:0.1}});
  assert.strictEqual(m.eyes,1);
  near(m.closed,0.1,1e-9,"보이는 눈(오른쪽)의 감김만 씁니다");
});

console.log("보정과 회귀");
var CAL=null;
test("9칸 보정 뒤 9칸을 모두 맞힌다",function(){
  CAL=calibrate({});
  assert.ok(CAL.model.rms<0.08,"남은 오차 "+CAL.model.rms);
  for(var z=1;z<=9;z++){
    var c=G.zoneCenter(z),p=G.predict(CAL.model,G.featureVec(meas({gx:c.x,gy:c.y})));
    assert.strictEqual(G.zoneOf(p.x,p.y),z,"칸 "+z+" -> "+JSON.stringify(p));
  }
});
test("표본이 모자라면 모델을 만들지 않는다",function(){
  assert.strictEqual(G.ridgeFit([]),null);
  assert.strictEqual(G.ridgeFit([{f:[0,0,0,0,0,0,0,0],x:0.5,y:0.5}]),null);
});
test("빠른 재보정이 치우침을 고친다",function(){
  var model=JSON.parse(JSON.stringify(CAL.model)),z,c,p,wrong=0;
  for(z=1;z<=9;z++){c=G.zoneCenter(z);p=G.predict(model,G.featureVec(meas({gx:c.x,gy:c.y,shift:0.09})));if(G.zoneOf(p.x,p.y)!==z)wrong++;}
  assert.ok(wrong>0,"치우치면 틀리는 칸이 생겨야 시험이 의미가 있습니다");
  var feats=[];for(var i=0;i<20;i++)feats.push(G.featureVec(meas({shift:0.09})));
  assert.strictEqual(G.biasFix(model,feats),true);
  for(z=1;z<=9;z++){c=G.zoneCenter(z);p=G.predict(model,G.featureVec(meas({gx:c.x,gy:c.y,shift:0.09})));assert.strictEqual(G.zoneOf(p.x,p.y),z,"칸 "+z);}
  assert.strictEqual(G.biasFix(model,[]),false);
  var far=[];for(i=0;i<5;i++)far.push(G.featureVec(meas({shift:0.6})));
  var before=JSON.stringify(model.off);
  assert.strictEqual(G.biasFix(model,far),false,"너무 크게 어긋나면 처음부터 다시 보정해야 합니다");
  assert.strictEqual(JSON.stringify(model.off),before);
});
test("표본 모으기: 눈을 감거나 얼굴이 없으면 채워지지 않는다",function(){
  var col=new G.Collector(),t=0,i;col.start(0);
  for(i=0;i<100;i++){t+=33;col.update(meas({}),0.9,t);}
  assert.strictEqual(col.progress(),0,"눈 감음");
  for(i=0;i<100;i++){t+=33;col.update(null,0,t);}
  assert.strictEqual(col.progress(),0,"얼굴 없음");
  col.start(t);
  for(i=0;i<10;i++){t+=33;assert.strictEqual(col.update(meas({}),0,t),0,"눈을 옮길 시간 동안은 0");}
});
test("표본 모으기: 눈을 다른 데로 돌리면 처음부터 다시",function(){
  var col=new G.Collector(),t=0,i;col.start(0);
  for(i=0;i<35;i++){t+=33;col.update(meas({gx:0.2}),0,t);}
  assert.ok(col.progress()>0.2&&!col.done());
  t+=33;col.update(meas({gx:0.9}),0,t);
  assert.strictEqual(col.progress(),0);
});
test("표본 모으기: 떨림이 큰 카메라에서도 끝난다",function(){
  var col=new G.Collector(),t=0,r=rng(3);col.start(0);
  for(var i=0;i<900&&!col.done();i++){t+=66;col.update(meas({noise:0.5,rnd:r}),0,t);}
  assert.ok(col.done(),"30초 안에 끝나야 합니다. 진행 "+col.progress());
});

console.log("머리 각도 보정 (3차원 모의 얼굴)");
/* 카메라가 화면 위 가운데에 있고, 50cm 앞에 머리가 있다고 놓습니다. 길이 단위 mm.
   좌표: X 환자의 오른쪽, Y 아래, Z 카메라에서 환자 쪽. 눈은 화면의 목표점을 실제로 향하게 만듭니다.
   o: tx, ty 보는 곳(0~1), yaw 오른쪽으로 돌림(도), pitch 아래로 숙임, roll 시계 방향 기울임(뒤집은 화면 기준) */
var SCREEN={w:250,h:170,top:10};
function face3d(o){
  var k=Math.PI/180,ps=(o.yaw||0)*k,th=(o.pitch||0)*k,ro=(o.roll||0)*k;
  function rot(v){
    var x=v[0],y=v[1],z=v[2],y2=y*Math.cos(th)-z*Math.sin(th),z2=y*Math.sin(th)+z*Math.cos(th);   /* 숙임 */
    return [x*Math.cos(ps)-z2*Math.sin(ps),y2,x*Math.sin(ps)+z2*Math.cos(ps)];                      /* 돌림 */
  }
  var ex=rot([Math.cos(ro),Math.sin(ro),0]),ey=rot([-Math.sin(ro),Math.cos(ro),0]),ez=rot([0,0,-1]);
  var H=[o.hx||0,80,o.dist||500];
  function W(a,b,c){return [H[0]+a*ex[0]+b*ey[0]+c*ez[0],H[1]+a*ex[1]+b*ey[1]+c*ez[1],H[2]+a*ex[2]+b*ey[2]+c*ez[2]]}
  var T=[-SCREEN.w/2+SCREEN.w*o.tx,SCREEN.top+SCREEN.h*o.ty,0],lm=[],i;
  function put(i,p){lm[i]={x:0.5-F*p[0]/p[2]/VW,y:0.5+F*p[1]/p[2]/VH,z:(p[2]-H[2])/VW}}
  for(i=0;i<478;i++)put(i,H);
  put(10,W(0,-70,0));put(152,W(0,95,0));put(234,W(72,20,-30));put(454,W(-72,20,-30));put(1,W(0,35,28));
  function eye(e,cx,sgn){
    var C0=W(cx,0,-12),d=[T[0]-C0[0],T[1]-C0[1],T[2]-C0[2]],n=Math.sqrt(d[0]*d[0]+d[1]*d[1]+d[2]*d[2]);
    d=[d[0]/n,d[1]/n,d[2]/n];
    /* 머리 기준 시선 성분 */
    var a=d[0]*ex[0]+d[1]*ex[1]+d[2]*ex[2],b=d[0]*ey[0]+d[1]*ey[1]+d[2]*ey[2],c=d[0]*ez[0]+d[1]*ez[1]+d[2]*ez[2];
    var ia=cx+12*a,ib=12*b,ic=-12+12*c;
    put(e.outer,W(cx+sgn*15,0,0));put(e.inner,W(cx-sgn*15,0,0));
    put(e.up,W(cx,-5+0.7*12*b,0));put(e.low,W(cx,5,0));
    put(e.iris,W(ia,ib,ic));
    put(e.ring[0],W(ia+5.85,ib,ic));put(e.ring[1],W(ia,ib-5.85,ic));put(e.ring[2],W(ia-5.85,ib,ic));put(e.ring[3],W(ia,ib+5.85,ic));
  }
  eye(G.EYE.R,31.5,1);eye(G.EYE.L,-31.5,-1);
  /* MediaPipe 얼굴 변환 행렬(열 우선): 실제 모델 출력과 같은 규칙 */
  var mat=[ex[0],ex[1],ex[2],0, ey[0],ey[1],ey[2],0, -ez[0],-ez[1],-ez[2],0, 0,0,-50,1];
  return G.measure(lm,{vw:VW,vh:VH,matrix:mat});
}
function calibrate3d(){
  var samples=[];
  for(var z=1;z<=9;z++){var c=G.zoneCenter(z);for(var i=0;i<4;i++)samples.push({f:G.featureVec(face3d({tx:c.x,ty:c.y})),x:c.x,y:c.y});}
  return G.ridgeFit(samples,null,SCREEN.w/SCREEN.h);
}
function worst(model,pose){
  var e=0,hit=0;
  for(var z=1;z<=9;z++){
    var c=G.zoneCenter(z),a={tx:c.x,ty:c.y};for(var k in pose)a[k]=pose[k];
    var p=G.predict(model,G.featureVec(face3d(a)));
    e=Math.max(e,Math.abs(p.x-c.x),Math.abs(p.y-c.y));
    if(G.zoneOf(p.x,p.y)===z)hit++;
  }
  return {err:e,hit:hit};
}
var M3=null;
test("모의 얼굴: 머리 각도를 실제 모델과 같은 부호로 읽는다",function(){
  var m=face3d({tx:0.5,ty:0.5,yaw:20});near(m.yaw,20,0.5,"오른쪽으로 돌림");
  m=face3d({tx:0.5,ty:0.5,pitch:10});near(m.pitch,10,0.5,"아래로 숙임");
  m=face3d({tx:0.5,ty:0.5,roll:15});near(m.roll,15,1.5,"기울임");
  /* 같은 곳을 보면서 머리를 오른쪽으로 돌리면 홍채는 왼쪽으로 갑니다(실제 사진에서 확인한 방향) */
  assert.ok(face3d({tx:0.5,ty:0.5,yaw:15}).hx<face3d({tx:0.5,ty:0.5}).hx-0.05);
});
test("머리를 바로 두고 보정하면 9칸을 맞힌다",function(){
  M3=calibrate3d();
  assert.ok(M3,"모델");
  var r=worst(M3,{});
  assert.strictEqual(r.hit,9);assert.ok(r.err<0.08,"오차 "+r.err);
});
test("머리가 기울어도(roll) 9칸을 맞힌다",function(){
  [-25,-12,12,25].forEach(function(roll){
    var r=worst(M3,{roll:roll});
    assert.strictEqual(r.hit,9,"기울임 "+roll+"° 맞힌 칸 "+r.hit+", 오차 "+r.err.toFixed(3));
  });
});
test("머리를 좌우, 상하로 돌려도 보정하면 9칸을 맞히고, 보정을 끄면 틀린다",function(){
  var poses=[{yaw:12},{yaw:-12},{pitch:8},{pitch:-8},{yaw:10,pitch:6},{yaw:-8,pitch:-6,roll:15}];
  var off=JSON.parse(JSON.stringify(M3));off.head=false;
  var worse=0;
  poses.forEach(function(p){
    var on=worst(M3,p),no=worst(off,p);
    assert.strictEqual(on.hit,9,JSON.stringify(p)+" 맞힌 칸 "+on.hit+", 오차 "+on.err.toFixed(3));
    assert.ok(on.err<no.err,JSON.stringify(p)+" 보정 "+on.err.toFixed(3)+" / 끔 "+no.err.toFixed(3));
    if(no.hit<9)worse++;
  });
  assert.ok(worse>=4,"보정을 끄면 틀리는 자세가 여럿 있어야 시험이 의미가 있습니다: "+worse);
});
test("머리 각도 보정은 너무 큰 각도에서 폭주하지 않는다",function(){
  var f=G.featureVec(face3d({tx:0.5,ty:0.5})),g=f.slice();g[3]+=170;
  var a=G.headShift(M3,f),b=G.headShift(M3,g);
  near(a.x,0,0.05);assert.ok(Math.abs(b.x)<3,"30도에서 묶임: "+b.x);
  var bad=JSON.parse(JSON.stringify(M3));bad.wx[0]=-1;
  assert.deepStrictEqual(G.headShift(bad,g),{x:0,y:0},"좌우 방향을 못 배운 모델에서는 쓰지 않음");
});

console.log("부드럽게 하기와 칸 판정");
test("One-Euro 필터가 떨림을 줄이고 이동은 따라간다",function(){
  var f=new G.OneEuro(0.6,0.5),r=rng(11),t=0,i,inV=0,outV=0;
  for(i=0;i<300;i++){t+=1/30;var x=0.5+gauss(r)*0.03,y=f.filter(x,t);if(i>30){inV+=Math.pow(x-0.5,2);outV+=Math.pow(y-0.5,2);}}
  assert.ok(outV<inV*0.3,"떨림 "+inV.toFixed(4)+" -> "+outV.toFixed(4));
  var g=new G.OneEuro(0.6,0.5),v=0;t=0;
  for(i=0;i<30;i++){t+=1/30;g.filter(0.2,t);}
  for(i=0;i<15;i++){t+=1/30;v=g.filter(0.8,t);}
  assert.ok(v>0.7,"0.5초 안에 새 위치로 가야 합니다: "+v);
});
test("zoneOf는 3x3 칸 번호를 준다",function(){
  assert.strictEqual(G.zoneOf(0.1,0.1),1);assert.strictEqual(G.zoneOf(0.5,0.5),5);
  assert.strictEqual(G.zoneOf(0.9,0.9),9);assert.strictEqual(G.zoneOf(0.9,0.1),3);
  assert.strictEqual(G.zoneOf(1,1),9);assert.strictEqual(G.zoneOf(-0.2,0.4),4);
  for(var z=1;z<=9;z++){var c=G.zoneCenter(z);assert.strictEqual(G.zoneOf(c.x,c.y),z);}
});
test("새 칸에 150ms 머물러야 칸이 바뀐다",function(){
  var h=new G.ZoneHold(150);
  assert.strictEqual(h.update(1,0),1,"처음에는 바로");
  assert.strictEqual(h.update(2,33),1);
  assert.strictEqual(h.update(2,100),1);
  assert.strictEqual(h.update(2,190),2,"150ms 지나면 바뀜");
  /* 경계에서 떨림: 1과 2를 오가면 그대로 */
  var k=new G.ZoneHold(150),t=0,i;k.update(1,0);
  for(i=0;i<40;i++){t+=33;assert.strictEqual(k.update(i%2?1:2,t),1);}
  /* 2로 가다가 3으로 바꾸면 3에서 다시 셈 */
  var q=new G.ZoneHold(150);q.update(1,0);q.update(2,10);q.update(2,100);
  assert.strictEqual(q.update(3,170),1);assert.strictEqual(q.update(3,300),1);assert.strictEqual(q.update(3,321),3);
  assert.strictEqual(q.update(null,400),3,"값이 없으면 그대로");
});

console.log("깜빡임");
function runBlink(det,closedMs,step){
  var t=0,n={blink:0,alarm:0},i,r;
  for(i=0;i<10;i++){t+=step;det.update(0.05,t);}
  var end=t+closedMs;
  while(t<end){t+=step;r=det.update(0.9,t);n.blink+=r.blink?1:0;n.alarm+=r.alarm?1:0;}
  for(i=0;i<10;i++){t+=step;r=det.update(0.05,t);n.blink+=r.blink?1:0;n.alarm+=r.alarm?1:0;}
  return n;
}
test("감은 시간이 범위 안일 때만 깜빡임 한 번",function(){
  var o={minMs:200,maxMs:1000,alarmMs:3000};
  assert.strictEqual(runBlink(new G.BlinkDetector(o),400,33).blink,1,"0.4초");
  assert.strictEqual(runBlink(new G.BlinkDetector(o),100,33).blink,0,"무의식 깜빡임 0.1초");
  assert.strictEqual(runBlink(new G.BlinkDetector(o),1500,33).blink,0,"1.5초는 너무 김");
  assert.strictEqual(runBlink(new G.BlinkDetector(o),400,66).blink,1,"초당 15프레임에서도");
});
test("3초 이상 감으면 호출음을 한 번만, 끄면 울리지 않는다",function(){
  var a=runBlink(new G.BlinkDetector({alarmMs:3000}),5000,33);
  assert.strictEqual(a.alarm,1);assert.strictEqual(a.blink,0);
  assert.strictEqual(runBlink(new G.BlinkDetector({alarmMs:3000}),2500,33).alarm,0);
  assert.strictEqual(runBlink(new G.BlinkDetector({alarmMs:0}),5000,33).alarm,0,"끔");
  assert.strictEqual(runBlink(new G.BlinkDetector({alarmMs:1000,maxMs:800}),1500,33).alarm,1,"시간을 바꿈");
});
test("기준 사이에서 떨려도 여러 번 세지 않는다",function(){
  var d=new G.BlinkDetector({minMs:100}),t=0,n=0,i;
  var seq=[0.1,0.1,0.6,0.45,0.55,0.4,0.6,0.45,0.5,0.1,0.1,0.1];
  for(i=0;i<seq.length;i++){t+=40;if(d.update(seq[i],t).blink)n++;}
  assert.strictEqual(n,1);
});

console.log("추적기");
function tracker(o){
  o=o||{};
  return new G.Tracker({model:JSON.parse(JSON.stringify(CAL.model)),blink:o.blink||{minMs:200,maxMs:1000,alarmMs:3000}});
}
function look(tr,z,ms,t,extra){
  var c=G.zoneCenter(z),out=null,end=t.v+ms;
  while(t.v<end){
    t.v+=33;
    var a={gx:c.x,gy:c.y};for(var k in extra||{})a[k]=extra[k];
    out=tr.step(meas(a),t.v);
    if(t.log)t.log.push(out);
  }
  return out;
}
test("보는 칸을 따라가고, 감는 동안에는 감기 직전 칸을 유지한다",function(){
  var tr=tracker(),t={v:0,log:[]},out;
  out=look(tr,1,600,t);assert.strictEqual(out.zone,1);assert.ok(out.pt);
  out=look(tr,9,700,t);assert.strictEqual(out.zone,9);
  t.log=[];
  /* 눈을 감으면 홍채가 아래로 흔들리는 것처럼(칸 3을 보는 값) 넣어도 9를 유지 */
  out=look(tr,3,400,t,{closed:0.9});
  assert.strictEqual(out.zone,9);assert.ok(out.pt,"감는 동안에도 입력 점은 살아 있어야 깜빡임이 먹힙니다");
  assert.strictEqual(out.closed,true);
  t.log=[];
  look(tr,9,300,t);
  var blinks=t.log.filter(function(o){return o.blink});
  assert.strictEqual(blinks.length,1,"눈을 뜰 때 깜빡임 한 번");
  assert.strictEqual(blinks[0].zone,9);assert.ok(blinks[0].pt);
});
test("칸을 옮길 때 150ms 뒤에 바뀐다",function(){
  var tr=tracker(),t={v:0,log:[]};
  look(tr,4,600,t);
  t.log=[];look(tr,6,900,t);
  var first=-1;t.log.forEach(function(o,i){if(first<0&&o.zone===6)first=i;});
  assert.ok(first>=4,"적어도 150ms(33ms x 5프레임쯤) 뒤: "+first);
  assert.ok(first<20,"그래도 0.7초 안에는 바뀌어야 합니다: "+first);
  assert.ok(t.log.every(function(o){return o.zone===4||o.zone===5||o.zone===6}));
});
test("너무 오래 감으면 입력을 멈추고, 3초에 호출음",function(){
  var tr=tracker(),t={v:0,log:[]};
  look(tr,5,500,t);t.log=[];
  look(tr,5,3500,t,{closed:0.95});
  assert.ok(t.log[Math.floor(2000/33)].pt,"길게 깜빡임 시간(2.5초)까지는 칸을 유지");
  assert.strictEqual(t.log[t.log.length-1].pt,null);
  assert.strictEqual(t.log[t.log.length-1].why,"closed");
  assert.strictEqual(t.log.filter(function(o){return o.alarm}).length,1);
  t.log=[];look(tr,5,500,t);
  assert.strictEqual(t.log.filter(function(o){return o.blink}).length,0,"길게 감은 것은 깜빡임이 아닙니다");
  assert.strictEqual(t.log[t.log.length-1].zone,5,"눈을 뜨면 다시 이어집니다");
});
test("길게 감았다 뜨면 길게 깜빡임 한 번, 칸은 감기 직전 그대로",function(){
  var tr=tracker(),t={v:0,log:[]};
  look(tr,2,600,t);t.log=[];
  var mid=look(tr,7,1800,t,{closed:0.95});
  assert.ok(mid.pt,"길게 감는 동안에도 칸을 붙들고 있어야 합니다");assert.strictEqual(mid.zone,2);
  look(tr,2,400,t);
  var longs=t.log.filter(function(o){return o.long});
  assert.strictEqual(longs.length,1);assert.strictEqual(longs[0].zone,2);
  assert.strictEqual(t.log.filter(function(o){return o.blink}).length,0,"보통 깜빡임으로는 치지 않습니다");
  /* 보통 깜빡임은 길게 깜빡임이 아닙니다 */
  t.log=[];look(tr,2,400,t,{closed:0.95});look(tr,2,400,t);
  assert.strictEqual(t.log.filter(function(o){return o.long}).length,0);
  assert.strictEqual(t.log.filter(function(o){return o.blink}).length,1);
  /* 너무 오래(2.5초 넘게) 감은 것도 아닙니다 */
  t.log=[];look(tr,2,2900,t,{closed:0.95});look(tr,2,400,t);
  assert.strictEqual(t.log.filter(function(o){return o.long}).length,0);
});
test("시선 민감도: 1 은 예전 값 그대로, 둔감할수록 여유와 머무는 시간이 늘고 빠른 움직임을 더 거른다",function(){
  assert.deepStrictEqual(G.sense(1),{margin:0,holdMs:150,beta:0.5});
  var a=G.sense(3),b=G.sense(5);
  assert.ok(a.margin>0&&b.margin>a.margin&&b.margin<=0.3);
  assert.ok(a.holdMs>150&&b.holdMs>a.holdMs);
  assert.ok(a.beta<0.5&&b.beta<a.beta&&b.beta>0);
});
test("지금 칸은 경계를 여유만큼 넘어가야 벗어난다",function(){
  /* 5번 칸의 오른쪽 경계는 x=2/3. 여유 0.15 면 2/3+0.05 까지는 5번 */
  assert.strictEqual(G.zoneSticky(0.69,0.5,5,0),6);
  assert.strictEqual(G.zoneSticky(0.69,0.5,5,0.15),5);
  assert.strictEqual(G.zoneSticky(0.73,0.5,5,0.15),6);
  assert.strictEqual(G.zoneSticky(0.69,0.5,null,0.15),6,"지금 칸이 없으면 보는 자리 그대로");
  assert.strictEqual(G.zoneSticky(0.64,0.5,6,0.15),6,"돌아올 때도 같은 여유");
});
test("둔감하게 두면 경계 근처에서 흔들려도 칸이 바뀌지 않는다",function(){
  function run(level){
    var tr=tracker(),t={v:0,log:[]},c=G.zoneCenter(5),n=0,last=5;
    tr.setSense(G.sense(level));
    look(tr,5,600,t);
    /* 5번과 6번의 경계(x=2/3) 양쪽으로 0.03 씩, 0.3초마다 오가는 눈 */
    for(var i=0;i<20;i++){
      var x=2/3+(i%2?0.03:-0.03),end=t.v+300,out;
      while(t.v<end){t.v+=33;out=tr.step(meas({gx:x,gy:c.y}),t.v);}
      if(out.zone!==last){n++;last=out.zone;}
    }
    return n;
  }
  assert.ok(run(1)>=10,"민감: 경계를 넘을 때마다 바뀝니다 "+run(1));
  assert.strictEqual(run(3),0,"보통: 바뀌지 않습니다");
});
test("둔감하게 두어도 옆 칸 한가운데를 보면 1초 안에 바뀐다",function(){
  var tr=tracker(),t={v:0,log:[]};
  tr.setSense(G.sense(5));
  look(tr,4,600,t);
  assert.strictEqual(look(tr,5,1000,t).zone,5);
  assert.strictEqual(look(tr,9,1000,t).zone,9);
});
test("가운데 한 점 기준으로 화면을 향하는지 가린다",function(){
  var ms=[],i;
  for(i=0;i<10;i++)ms.push(meas({gx:0.5,gy:0.5}));
  var ref=G.centerRef(ms);
  for(var z=1;z<=9;z++){var c=G.zoneCenter(z);assert.ok(G.facing(meas({gx:c.x,gy:c.y}),ref),"칸 "+z+" 을 볼 때");}
  assert.ok(G.facing(meas({gx:0.02,gy:0.98}),ref),"화면 모서리");
  assert.strictEqual(G.facing(meas({gx:1.6,gy:0.5}),ref),false,"화면 오른쪽 멀리");
  assert.strictEqual(G.facing(meas({gx:-0.6,gy:0.5}),ref),false,"화면 왼쪽 멀리");
  assert.strictEqual(G.facing(meas({gx:0.5,gy:2.2}),ref),false,"화면 아래 멀리");
  assert.strictEqual(G.facing(null,ref),false,"얼굴이 없을 때");
  var one=meas({gx:0.5,gy:0.5});one.eyes=1;
  assert.strictEqual(G.facing(one,ref),false,"한쪽 눈만 보일 때");
  /* 머리만 돌린 만큼도 벗어난 것으로 칩니다 */
  var turned=meas({gx:0.5,gy:0.5});turned.yaw+=40;
  assert.strictEqual(G.facing(turned,ref),false,"머리를 40도 돌렸을 때");
  assert.ok(Math.abs(G.gazeOff(meas({gx:0.5,gy:0.5}),ref).x)<1);
});
test("눈 깜빡임 민감도: 3 은 예전 문턱, 민감할수록 덜 감아도 감은 것으로 본다",function(){
  assert.deepStrictEqual(G.blinkSense(3),{on:0.5,off:0.35});
  var a=G.blinkSense(1),b=G.blinkSense(5);
  assert.ok(a.on>0.5&&b.on<0.5&&a.off<a.on&&b.off<b.on&&b.off>0);
  /* 반쯤(0.42) 감는 깜빡임: 보통에서는 못 읽고 민감에서는 읽습니다 */
  function blinks(level){
    var s=G.blinkSense(level),d=new G.BlinkDetector({on:s.on,off:s.off,minMs:100,maxMs:1000}),n=0,t=0;
    [0,0.42,0.42,0.42,0.42,0.42,0,0].forEach(function(c){t+=60;if(d.update(c,t).blink)n++;});
    return n;
  }
  assert.strictEqual(blinks(3),0);assert.strictEqual(blinks(5),1);
});
test("길게 감고 있으면 길게 깜빡임 길이를 넘는 순간 한 번 알린다",function(){
  var tr=tracker(),t={v:0,log:[]};
  look(tr,5,500,t);t.log=[];
  look(tr,5,600,t,{closed:0.95});
  assert.strictEqual(t.log.filter(function(o){return o.longReady}).length,0,"짧게 감은 동안에는 알리지 않습니다");
  look(tr,5,300,t);t.log=[];
  var t0=t.v;
  look(tr,5,1800,t,{closed:0.95});
  var hit=t.log.filter(function(o){return o.longReady});
  assert.strictEqual(hit.length,1,"감는 동안 한 번만");
  var at=t.log.indexOf(hit[0])*33;
  assert.ok(at>=1000&&at<=1150,"1초(길게 깜빡임 경계)를 막 넘었을 때: "+at);
  look(tr,5,300,t);t.log=[];
  look(tr,5,1500,t,{closed:0.95});
  assert.strictEqual(t.log.filter(function(o){return o.longReady}).length,1,"다음에 감을 때 다시 알립니다");
});
test("눈을 뜰 때 감고 있던 시간을 알려 준다",function(){
  var tr=tracker(),t={v:0,log:[]};
  look(tr,5,500,t);t.log=[];
  look(tr,5,400,t,{closed:0.95});look(tr,5,300,t);
  var op=t.log.filter(function(o){return o.opened});
  assert.strictEqual(op.length,1);
  assert.ok(op[0].dur>=330&&op[0].dur<=470,"감은 시간 "+op[0].dur);
});
test("깜빡임 횟수 방식에서는 시선 자리가 없어도 길게 깜빡임을 읽는다",function(){
  var tr=tracker(),t={v:0,log:[]};
  tr.model=null;                     /* 보정이 없어 시선 자리를 모르는 상태 */
  look(tr,2,600,t);look(tr,2,1800,t,{closed:0.95});look(tr,2,400,t);
  assert.strictEqual(t.log.filter(function(o){return o.long}).length,0,"보통은 읽지 않습니다");
  tr.longAnywhere=true;t.log=[];
  look(tr,2,1800,t,{closed:0.95});look(tr,2,400,t);
  assert.strictEqual(t.log.filter(function(o){return o.long}).length,1);
});
test("얼굴을 놓치면 입력을 멈춘다",function(){
  var tr=tracker(),t={v:0};
  look(tr,5,500,t);
  var out=tr.step(null,t.v+33);
  assert.strictEqual(out.pt,null);assert.strictEqual(out.why,"face");
  for(var i=0;i<60;i++)out=tr.step(null,t.v+33*(i+2));
  assert.strictEqual(out.pt,null);
  t.v+=33*62;
  assert.strictEqual(look(tr,2,600,t).zone,2,"돌아오면 다시 잡습니다");
});
test("보정이 없으면 입력을 멈춘다",function(){
  var tr=new G.Tracker({}),out=tr.step(meas({}),33);
  assert.strictEqual(out.pt,null);assert.strictEqual(out.why,"model");
});
test("한 프레임만 튄 값은 버린다",function(){
  var tr=tracker(),t={v:0,log:[]};
  look(tr,1,600,t);
  var c=G.zoneCenter(9);t.v+=33;
  var out=tr.step(meas({gx:c.x,gy:c.y}),t.v);
  assert.strictEqual(out.zone,1);
  t.log=[];look(tr,1,400,t);
  assert.ok(t.log.every(function(o){return o.zone===1}),"칸 1을 벗어나지 않아야 합니다");
});
test("화면 밖을 보면 입력을 멈춘다",function(){
  var tr=tracker(),t={v:0},out,i;
  look(tr,5,400,t);
  for(i=0;i<40;i++){t.v+=33;out=tr.step(meas({gx:3.5,gy:0.5}),t.v);}
  assert.strictEqual(out.pt,null);assert.strictEqual(out.why,"away");
});
test("화면 밖 허용 폭을 넓히면 가장자리에 붙은 점으로 읽는다",function(){
  var tr=tracker(),t={v:0},out,i;
  tr.away=1.5;
  look(tr,5,400,t);
  for(i=0;i<40;i++){t.v+=33;out=tr.step(meas({gx:1.9,gy:0.5}),t.v);}
  assert.ok(out.pt,"화면 오른쪽 밖을 봐도 입력이 살아 있어야 합니다");
  assert.strictEqual(out.pt.x,1);assert.strictEqual(out.zone,6);
});
test("눈을 떠도 나오는 감김 점수(c0)는 감은 것으로 치지 않는다",function(){
  var tr=tracker(),t={v:0,log:[]};
  tr.model.c0=0.45;
  look(tr,8,800,t,{closed:0.5});
  assert.strictEqual(t.log[t.log.length-1].zone,8,"아래 줄을 볼 때 점수가 높아도 칸을 읽어야 합니다");
  assert.ok(t.log.every(function(o){return !o.closed}));
  t.log=[];look(tr,8,400,t,{closed:0.95});look(tr,8,300,t,{closed:0.5});
  assert.strictEqual(t.log.filter(function(o){return o.blink}).length,1,"진짜로 감으면 깜빡임");
});
test("눈꺼풀이 반쯤 내려온 채 오래 있으면 입력을 멈춘다",function(){
  var tr=tracker(),t={v:0,log:[]};
  look(tr,5,500,t);
  var out=look(tr,5,600,t,{closed:0.42});
  assert.ok(out.pt,"잠깐은 마지막 칸을 유지");assert.strictEqual(out.zone,5);
  out=look(tr,5,900,t,{closed:0.42});
  assert.strictEqual(out.pt,null);assert.strictEqual(out.why,"closed");
  assert.strictEqual(look(tr,5,500,t).zone,5,"눈을 다 뜨면 다시 이어집니다");
});
test("표본 모으기: 기다려도 허용 폭은 3배까지만 넓어진다",function(){
  var col=new G.Collector(),t=0,i;col.start(0);
  /* 2분 동안 눈이 크게 오가면 끝내 채워지지 않아야 합니다 */
  for(i=0;i<3600&&!col.done();i++){t+=33;col.update(meas({gx:i%2?0.1:0.9}),0,t);}
  assert.strictEqual(col.done(),false);
});
test("감김 점수가 없으면 눈꺼풀 간격으로 깜빡임을 읽는다",function(){
  var tr=tracker(),t=0,n=0,i,out;
  function step(closed){t+=33;out=tr.step(G.measure(fakeFace({closed:closed}),{vw:VW,vh:VH}),t);if(out.blink)n++;}
  for(i=0;i<30;i++)step(0);
  for(i=0;i<12;i++)step(0.95);
  for(i=0;i<15;i++)step(0);
  assert.strictEqual(n,1);
});

console.log("자세 점검, 품질, 태블릿 옮김");
test("자세 점검이 보호자 안내를 고른다",function(){
  var P=G.postureCheck;
  assert.ok(/보이지 않습니다/.test(P(null,100).msg));
  var ok=P(meas({distCm:50}),120);
  assert.strictEqual(ok.ok,true,JSON.stringify(ok));
  assert.ok(/가까이/.test(P(meas({distCm:90}),120).msg),"홍채가 8px 보다 작게 찍힘");
  assert.strictEqual(P(meas({distCm:90}),120).items.dist,false);
  assert.ok(/멀리/.test(P(meas({distCm:13}),120).msg),"얼굴이 화면을 다 채움");
  /* 거리는 cm 가 아니라 홍채 픽셀로 봅니다: 멀어도 크게 찍히면(줌) 통과 */
  var far=meas({distCm:50});far.distCm=100;
  assert.strictEqual(P(far,120).ok,true,"1m 라도 홍채가 충분히 크면 통과");
  var small=meas({distCm:50});small.irisPx=6;
  assert.strictEqual(P(small,120).items.dist,false);
  assert.strictEqual(P(meas({cx:0.25,cy:0.3}),120).ok,true,"가운데가 아니어도 됩니다(잘라서 가운데로 옮겨 읽음)");
  assert.ok(/왼쪽/.test(P(meas({cx:0.08}),120).msg));
  assert.ok(/오른쪽/.test(P(meas({cx:0.92}),120).msg));
  assert.ok(/위로/.test(P(meas({cy:0.08}),120).msg));
  assert.ok(/아래로/.test(P(meas({cy:0.92}),120).msg));
  assert.ok(/밝게/.test(P(meas({}),20).msg));
  assert.strictEqual(P(meas({}),null).ok,true,"밝기를 아직 모르면 통과로 둡니다");
  var a=40*Math.PI/180,yawM=[Math.cos(a),0,-Math.sin(a),0,0,1,0,0,Math.sin(a),0,Math.cos(a),0,0,0,-50,1];
  var r=P(meas({matrix:yawM}),120);
  assert.strictEqual(r.items.angle,false);assert.ok(/마주 보게/.test(r.msg));
  var lm=fakeFace({}),e=G.EYE.L,mid=(lm[e.outer].x+lm[e.inner].x)/2;
  [e.outer,e.inner].forEach(function(i){lm[i].x=mid+(lm[i].x-mid)*0.4});
  r=P(G.measure(lm,{vw:VW,vh:VH}),120);
  assert.strictEqual(r.items.eyes,false);assert.strictEqual(r.ok,false);
});
test("먼 얼굴 찾기: 화면을 조각으로 나눠 차례로 본다",function(){
  var r=G.searchRegions(1920,1080);
  assert.strictEqual(r[0],null,"먼저 화면 전체");
  assert.strictEqual(r.length,1+9+25);
  r.slice(1).forEach(function(t){assert.ok(t.x>=0&&t.y>=0&&t.x+t.w<=1920.01&&t.y+t.h<=1080.01,JSON.stringify(t));});
  /* 화면 어디에 있는 작은 얼굴이든, 그 얼굴이 통째로 들어가는 1/3 크기 조각이 있어야 합니다 */
  for(var fx=60;fx<1860;fx+=97)for(var fy=60;fy<1020;fy+=83){
    var ok=r.some(function(t){return t&&t.w<700&&fx-50>=t.x&&fx+50<=t.x+t.w&&fy-60>=t.y&&fy+60<=t.y+t.h});
    assert.ok(ok,"얼굴 위치 "+fx+","+fy);
  }
  assert.strictEqual(G.searchRegions(4032,3024).length,1+9+25+49,"큰 영상은 한 단계 더");
});
test("얼굴 둘레 범위를 잡고, 꽤 벗어났을 때만 새로 잡는다",function(){
  var box={x0:0.45,x1:0.55,y0:0.4,y1:0.6},c=G.cropAround(box,1920,1080);
  near(c.w,216*1.5,0.5);near(c.x+c.w/2,960,0.5);near(c.y+c.h/2,540,0.5);
  near(c.fw,192,0.5);near(c.fw*c.scale,G.FACE_PX,0.5,"얼굴 너비가 400px 이 되게 확대");
  assert.strictEqual(G.FACE_PX,400);
  /* 아주 작은 얼굴도 400px 까지, 아주 큰 얼굴은 줄여서 400px */
  var tiny=G.cropAround({x0:0.49,x1:0.51,y0:0.47,y1:0.52},1920,1080);near(tiny.fw*tiny.scale,400,0.5);
  var huge=G.cropAround({x0:0.2,x1:0.8,y0:0.1,y1:0.9},1920,1080);near(huge.fw*huge.scale,400,0.5);assert.ok(huge.scale<1);
  /* 뒤집은 좌표의 오른쪽(x 0.9)은 원본 영상의 왼쪽 */
  var left=G.cropAround({x0:0.85,x1:0.95,y0:0.4,y1:0.6},1920,1080);
  assert.ok(left.x<300,"원본 왼쪽: "+left.x);assert.ok(left.x>=0);
  /* 가장자리 얼굴도 범위 한가운데에 둡니다(범위가 영상 밖으로 나가도 됨) */
  var edge=G.cropAround({x0:0,x1:0.1,y0:0,y1:0.2},1920,1080);
  near(edge.x+edge.w/2,1920*0.95,0.5);near(edge.y+edge.h/2,108,0.5);
  assert.ok(edge.x+edge.w>1920&&edge.y<0);
  assert.strictEqual(G.cropStale(c,G.cropAround({x0:0.455,x1:0.555,y0:0.4,y1:0.6},1920,1080)),false,"조금 움직임");
  assert.strictEqual(G.cropStale(c,G.cropAround({x0:0.5,x1:0.6,y0:0.4,y1:0.6},1920,1080)),true,"많이 움직임");
  assert.strictEqual(G.cropStale(c,G.cropAround({x0:0.43,x1:0.57,y0:0.36,y1:0.64},1920,1080)),true,"크기가 달라짐");
});
test("잘못 읽은 얼굴은 버린다",function(){
  var m=meas({distCm:50});
  assert.strictEqual(G.plausible(m,null,VW),true);
  assert.strictEqual(G.plausible(m,{x:0,y:0,w:400,h:400},VW),true);
  assert.strictEqual(G.plausible(m,{x:0,y:0,w:400,h:400},VW*40),true,"큰 영상에서도 잘라 넣은 범위에 견줍니다");
  var tiny=meas({distCm:50});tiny.box={x0:0.5,x1:0.51,y0:0.5,y1:0.52};
  assert.strictEqual(G.plausible(tiny,{x:0,y:0,w:400,h:400},VW),false,"범위에 비해 얼굴이 너무 작음");
  var odd=meas({distCm:50});odd.irisPx=odd.R.w*1.2;
  assert.strictEqual(G.plausible(odd,null,VW),false,"홍채가 눈보다 큼");
});
test("자세 점검 중 카메라 조절: 해상도, 줌",function(){
  var box={x0:0.46,x1:0.54,y0:0.42,y1:0.58},T=G.tuneCamera;
  assert.deepStrictEqual(T({irisPx:5,box:box,cut:false,zoom:1,zoomMin:1,zoomMax:4,canRes:true}),{res:true},"먼저 해상도");
  near(T({irisPx:5,box:box,cut:false,zoom:1,zoomMin:1,zoomMax:4,canRes:false}).zoom,1.3,1e-9,"다음은 줌");
  assert.strictEqual(T({irisPx:5,box:box,cut:false,zoom:1,zoomMin:1,zoomMax:1,canRes:false}),null,"줌이 없으면 그대로");
  assert.strictEqual(T({irisPx:14,box:box,cut:false,zoom:1,zoomMin:1,zoomMax:4,canRes:true}),null,"충분하면 그대로");
  near(T({irisPx:5,box:box,cut:false,zoom:3.9,zoomMin:1,zoomMax:4,canRes:false}).zoom,4,1e-9,"최대를 넘지 않음");
  var big={x0:0.2,x1:0.85,y0:0.1,y1:0.9};
  near(T({irisPx:20,box:big,cut:false,zoom:2.6,zoomMin:1,zoomMax:4,canRes:false}).zoom,2,1e-9,"얼굴이 너무 크면 줌을 풂");
  assert.strictEqual(T({irisPx:5,box:{x0:0.3,x1:0.7,y0:0.3,y1:0.7},cut:false,zoom:1,zoomMin:1,zoomMax:4,canRes:false}),null,"더 당기면 얼굴이 잘릴 때는 그대로");
  assert.ok(T({irisPx:20,box:{x0:0,x1:0.2,y0:0.3,y1:0.6},cut:true,zoom:2,zoomMin:1,zoomMax:4,canRes:false}).zoom<2,"끝에 닿으면 풂");
});
test("조건이 1초 이어져야 통과한다",function(){
  var g=new G.HoldGate(1000);
  assert.strictEqual(g.update(true,0),0);
  near(g.update(true,500),0.5,1e-9);
  assert.strictEqual(g.update(false,700),0,"끊기면 처음부터");
  g.update(true,800);
  assert.ok(g.update(true,1700)<1);
  assert.strictEqual(g.update(true,1800),1);
});
test("태블릿이 옮겨진 것을 알아챈다",function(){
  var base=G.baselineOf(CAL.ms);
  near(base.distCm,50,1);near(base.ex,0.5,0.01);
  var d=new G.MoveDetector(base),t=0,i,moved=false;
  for(i=0;i<60;i++){t+=33;moved=d.update(meas({gx:0.9,gy:0.1}),t)||moved;}
  assert.strictEqual(moved,false,"눈만 움직인 것은 옮긴 게 아닙니다");
  for(i=0;i<15;i++){t+=33;moved=d.update(meas({cx:0.75}),t)||moved;}
  assert.strictEqual(moved,false,"잠깐 움직인 것은 넘어갑니다");
  for(i=0;i<10;i++){t+=33;d.update(meas({}),t);}
  for(i=0;i<45;i++){t+=33;moved=d.update(meas({cx:0.75}),t)||moved;}
  assert.strictEqual(moved,true,"위치가 크게 바뀌어 1.2초 이어짐");
  var d2=new G.MoveDetector(base);moved=false;t=0;
  for(i=0;i<45;i++){t+=33;moved=d2.update(meas({distCm:68}),t)||moved;}
  assert.strictEqual(moved,true,"거리가 크게 바뀜");
  assert.strictEqual(new G.MoveDetector(base).update(null,0),false);
});
test("카메라 품질을 판단한다",function(){
  assert.strictEqual(G.quality({irisPx:13,fps:28,light:120}).level,"good");
  var q=G.quality({irisPx:6,fps:28,light:120});
  assert.strictEqual(q.level,"low");assert.ok(/가까이/.test(q.msg));
  q=G.quality({irisPx:13,fps:28,light:30});
  assert.strictEqual(q.level,"low");assert.ok(/밝게/.test(q.msg));
  assert.strictEqual(G.quality({irisPx:4,fps:28,light:120}).level,"bad");
  assert.strictEqual(G.quality({irisPx:13,fps:6,light:120}).level,"low");
  assert.strictEqual(G.needsLowRate(60,30),true);
  assert.strictEqual(G.needsLowRate(15,12),true);
  assert.strictEqual(G.needsLowRate(15,29),false);
  var f=new G.FpsMeter(),t=0,v=0;
  for(var i=0;i<100;i++){t+=40;v=f.update(t);}
  near(v,25,0.5,"프레임 속도");
});
test("정확도 확인용 다수결",function(){
  assert.strictEqual(G.majority([1,2,2,3,2,null]),2);
  assert.strictEqual(G.majority([]),null);
  assert.strictEqual(G.majority([null,null]),null);
  assert.strictEqual(G.median([3,1,2]),2);
});

console.log("\n통과 "+passed+"개, 실패 "+failed+"개");
process.exit(failed?1:0);
