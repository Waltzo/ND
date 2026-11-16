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
  assert.strictEqual(t.log[t.log.length-1].pt,null);
  assert.strictEqual(t.log[t.log.length-1].why,"closed");
  assert.strictEqual(t.log.filter(function(o){return o.alarm}).length,1);
  t.log=[];look(tr,5,500,t);
  assert.strictEqual(t.log.filter(function(o){return o.blink}).length,0,"길게 감은 것은 깜빡임이 아닙니다");
  assert.strictEqual(t.log[t.log.length-1].zone,5,"눈을 뜨면 다시 이어집니다");
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
  assert.ok(/가까이/.test(P(meas({distCm:90}),120).msg));
  assert.ok(/멀리/.test(P(meas({distCm:25}),120).msg));
  assert.ok(/왼쪽/.test(P(meas({cx:0.2}),120).msg));
  assert.ok(/오른쪽/.test(P(meas({cx:0.8}),120).msg));
  assert.ok(/위로/.test(P(meas({cy:0.2}),120).msg));
  assert.ok(/아래로/.test(P(meas({cy:0.8}),120).msg));
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
