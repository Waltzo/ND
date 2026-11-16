/* 눈담 시선 추정: 순수 함수 모음.
   화면(DOM)과 카메라를 쓰지 않으므로 node에서 가짜 입력으로 시험할 수 있습니다.
   카메라와 화면은 gaze.js가 맡고, 자판은 index.html의 window.Nundam 으로만 만납니다.
   나중에 다른 입력(방향만 읽기, 자동 순환)을 붙일 때도 이 파일의 측정값을 그대로 쓰면 됩니다. */
(function(root,factory){
  if(typeof module==="object"&&module.exports)module.exports=factory();
  else root.GazeCore=factory();
})(typeof self!=="undefined"?self:this,function(){
  "use strict";

  var IRIS_MM=11.7;   /* 사람 홍채 지름은 거의 일정합니다 */
  /* MediaPipe 얼굴 그물 번호. R, L은 환자 기준 오른쪽, 왼쪽 눈입니다. */
  var EYE={
    R:{outer:33,inner:133,up:159,low:145,iris:468,ring:[469,470,471,472]},
    L:{outer:263,inner:362,up:386,low:374,iris:473,ring:[474,475,476,477]}
  };
  var NOSE=1;

  function clamp(v,a,b){return v<a?a:(v>b?b:v)}
  function dist(a,b){var dx=a.x-b.x,dy=a.y-b.y;return Math.sqrt(dx*dx+dy*dy)}
  function median(a){
    if(!a.length)return 0;
    var s=a.slice().sort(function(x,y){return x-y}),h=s.length>>1;
    return s.length%2?s[h]:(s[h-1]+s[h])/2;
  }
  function majority(a){
    var n={},best=null,bc=0;
    a.forEach(function(v){if(v==null)return;n[v]=(n[v]||0)+1;if(n[v]>bc){bc=n[v];best=v;}});
    return best;
  }

  /* ---------- 한 프레임 측정 ---------- */

  /* 전면 카메라는 거울과 반대로 찍히므로 x를 뒤집어, 환자의 오른쪽이 화면 오른쪽이 되게 합니다. */
  function px(lm,i,vw,vh){var p=lm[i];return {x:(1-p.x)*vw,y:p.y*vh}}

  function eyeOf(lm,e,vw,vh){
    var o=px(lm,e.outer,vw,vh),n=px(lm,e.inner,vw,vh);
    var a=o.x<n.x?o:n,b=o.x<n.x?n:o;                 /* a: 화면 왼쪽 눈꼬리, b: 오른쪽 */
    var dx=b.x-a.x,dy=b.y-a.y,w=Math.sqrt(dx*dx+dy*dy);
    if(!(w>1))return null;
    var ux=dx/w,uy=dy/w,vx=-uy,vy=ux;                 /* u: 눈꼬리를 잇는 방향, v: 그 아래쪽 */
    var cx=(a.x+b.x)/2,cy=(a.y+b.y)/2;
    var ir=px(lm,e.iris,vw,vh),up=px(lm,e.up,vw,vh),low=px(lm,e.low,vw,vh);
    var r=e.ring.map(function(i){return px(lm,i,vw,vh)});
    return {
      w:w,
      irisPx:(dist(r[0],r[2])+dist(r[1],r[3]))/2,
      hx:((ir.x-cx)*ux+(ir.y-cy)*uy)/w,               /* 홍채의 좌우 위치 (눈 너비 기준) */
      hy:((ir.x-cx)*vx+(ir.y-cy)*vy)/w,               /* 홍채의 상하 위치 */
      ly:((up.x-cx)*vx+(up.y-cy)*vy)/w,               /* 윗눈꺼풀 높이: 아래를 보면 내려옵니다 */
      open:((low.x-up.x)*vx+(low.y-up.y)*vy)/w,       /* 눈 뜬 정도 */
      a:a,b:b,up:up,low:low,iris:ir,c:{x:cx,y:cy}
    };
  }

  /* 얼굴 변환 행렬(4x4)에서 머리 각도(도). 행렬이 없으면 null */
  function anglesOf(d){
    if(!d||d.length<16)return null;
    var c0,c2;
    /* MediaPipe는 열 우선으로 줍니다. 이동값이 넷째 행이 아니라 넷째 열에 있으면 행 우선으로 봅니다. */
    var rowMajor=(d[12]===0&&d[13]===0&&d[14]===0)&&(d[3]!==0||d[7]!==0||d[11]!==0);
    if(rowMajor){c0=[d[0],d[4],d[8]];c2=[d[2],d[6],d[10]];}
    else{c0=[d[0],d[1],d[2]];c2=[d[8],d[9],d[10]];}
    var k=180/Math.PI;
    return {
      yaw:-Math.atan2(c2[0],c2[2])*k,
      pitch:Math.atan2(-c2[1],Math.sqrt(c2[0]*c2[0]+c2[2]*c2[2]))*k,
      roll:-Math.atan2(c0[1],c0[0])*k
    };
  }

  /* lm: 얼굴 랜드마크 478개(0~1 좌표). o: {vw, vh, matrix, blink:{l,r}, hfov}
     얼굴을 읽을 수 없으면 null */
  function measure(lm,o){
    if(!lm||lm.length<478)return null;
    var vw=o.vw,vh=o.vh,R=eyeOf(lm,EYE.R,vw,vh),L=eyeOf(lm,EYE.L,vw,vh);
    if(!R||!L)return null;
    /* 고개를 돌리면 먼 쪽 눈이 좁게 찍힙니다. 많이 좁으면 가까운 눈만 씁니다. */
    var ratio=Math.min(R.w,L.w)/Math.max(R.w,L.w),both=ratio>=0.55;
    var use=both?[R,L]:[R.w>L.w?R:L];
    function avg(k){var s=0;use.forEach(function(e){s+=e[k]});return s/use.length}
    var irisPx=avg("irisPx");
    var f=Math.max(vw,vh)/2/Math.tan((o.hfov||60)*Math.PI/360);   /* 초점 거리(픽셀) 추정 */
    var x0=1,y0=1,x1=0,y1=0,i,p;
    for(i=0;i<468;i++){p=lm[i];var mx=1-p.x;if(mx<x0)x0=mx;if(mx>x1)x1=mx;if(p.y<y0)y0=p.y;if(p.y>y1)y1=p.y;}
    var mid={x:(R.c.x+L.c.x)/2,y:(R.c.y+L.c.y)/2},iod=dist(R.c,L.c);
    var ang=anglesOf(o.matrix);
    if(!ang){
      /* 행렬이 없을 때의 거친 추정: 눈을 잇는 선과 코끝 위치 */
      var ex=(R.c.x-L.c.x)/iod,ey=(R.c.y-L.c.y)/iod,n=px(lm,NOSE,vw,vh);
      var along=((n.x-mid.x)*ex+(n.y-mid.y)*ey)/iod,down=((n.x-mid.x)*-ey+(n.y-mid.y)*ex)/iod;
      ang={yaw:clamp(along*90,-60,60),pitch:clamp((0.55-down)*90,-60,60),roll:Math.atan2(ey,ex)*180/Math.PI};
    }
    var closed=null;
    if(o.blink)closed=both?Math.min(o.blink.l,o.blink.r):(use[0]===L?o.blink.l:o.blink.r);
    return {
      eyes:both?2:1,
      hx:avg("hx"),hy:avg("hy"),ly:avg("ly"),open:avg("open"),
      irisPx:irisPx,distCm:irisPx>0?f*IRIS_MM/irisPx/10:0,
      yaw:ang.yaw,pitch:ang.pitch,roll:ang.roll,
      ex:mid.x/vw,ey:mid.y/vh,
      box:{x0:x0,y0:y0,x1:x1,y1:y1},
      cut:x0<0.01||y0<0.01||x1>0.99||y1>0.99,
      closed:closed,
      R:R,L:L
    };
  }

  /* 눈 감김 점수(blendshape)가 없을 때 눈꺼풀 간격으로 대신 구합니다. */
  function EarCloser(){this.base=0}
  EarCloser.prototype.update=function(open){
    this.base=Math.max(this.base*0.999,open);
    if(!(this.base>0))return 0;
    return 1-clamp((open/this.base-0.2)/0.5,0,1);
  };

  /* ---------- 보정: 특징값 -> 화면 좌표 릿지 회귀 ---------- */

  /* 눈동자 방향 3개 + 머리 각도 3개 + 얼굴 위치 2개 */
  function featureVec(m){return [m.hx,m.hy,m.ly,m.yaw,m.pitch,m.roll,m.ex,m.ey]}
  /* 보정하는 동안 거의 변하지 않는 값이 부풀려지지 않게 하는 최소 폭 */
  var SD_FLOOR=[0.01,0.01,0.01,4,4,4,0.04,0.04];
  /* 머리 쪽 값은 보정 중에 조금밖에 안 움직여 우연히 맞춰지기 쉬우므로 더 세게 누릅니다. */
  var PENALTY=[1,1,1,20,20,20,20,20];

  function solve(A,b){
    var n=b.length,i,j,k,M=A.map(function(r,i){return r.concat([b[i]])});
    for(i=0;i<n;i++){
      var piv=i;
      for(j=i+1;j<n;j++)if(Math.abs(M[j][i])>Math.abs(M[piv][i]))piv=j;
      if(Math.abs(M[piv][i])<1e-12)return null;
      var t=M[i];M[i]=M[piv];M[piv]=t;
      for(j=i+1;j<n;j++){var q=M[j][i]/M[i][i];for(k=i;k<=n;k++)M[j][k]-=q*M[i][k];}
    }
    var x=new Array(n);
    for(i=n-1;i>=0;i--){var s=M[i][n];for(j=i+1;j<n;j++)s-=M[i][j]*x[j];x[i]=s/M[i][i];}
    return x;
  }

  /* samples: [{f:[특징값], x, y}] (x, y는 0~1 화면 좌표). 맞출 수 없으면 null */
  function ridgeFit(samples,lambda){
    var n=samples.length,d=SD_FLOOR.length,i,j,k;
    if(n<d+2)return null;
    lambda=lambda==null?0.02:lambda;
    var mean=[],sd=[];
    for(j=0;j<d;j++){
      var s=0,q=0;
      for(i=0;i<n;i++)s+=samples[i].f[j];
      s/=n;
      for(i=0;i<n;i++)q+=Math.pow(samples[i].f[j]-s,2);
      mean[j]=s;sd[j]=Math.max(Math.sqrt(q/n),SD_FLOOR[j]);
    }
    var Z=samples.map(function(sm){return sm.f.map(function(v,j){return (v-mean[j])/sd[j]})});
    var bx=0,by=0;
    for(i=0;i<n;i++){bx+=samples[i].x;by+=samples[i].y;}
    bx/=n;by/=n;
    var A=[],rx=[],ry=[];
    for(j=0;j<d;j++){
      A[j]=[];rx[j]=0;ry[j]=0;
      for(k=0;k<d;k++){var a=0;for(i=0;i<n;i++)a+=Z[i][j]*Z[i][k];A[j][k]=a/n+(j===k?lambda*PENALTY[j]:0);}
      for(i=0;i<n;i++){rx[j]+=Z[i][j]*(samples[i].x-bx);ry[j]+=Z[i][j]*(samples[i].y-by);}
      rx[j]/=n;ry[j]/=n;
    }
    var wx=solve(A,rx),wy=solve(A,ry);
    if(!wx||!wy)return null;
    var model={mean:mean,sd:sd,wx:wx,wy:wy,bx:bx,by:by,off:{x:0,y:0},c0:0,rms:0};
    var e=0;
    for(i=0;i<n;i++){var p=predict(model,samples[i].f);e+=Math.pow(p.x-samples[i].x,2)+Math.pow(p.y-samples[i].y,2);}
    model.rms=Math.sqrt(e/n);
    return model;
  }
  function predict(model,f){
    var x=model.bx+model.off.x,y=model.by+model.off.y,j,z;
    for(j=0;j<f.length;j++){z=(f[j]-model.mean[j])/model.sd[j];x+=model.wx[j]*z;y+=model.wy[j]*z;}
    return {x:x,y:y};
  }
  /* 빠른 재보정: 가운데를 볼 때의 특징값들로 치우침만 고칩니다. 너무 크게 어긋났으면 false */
  function biasFix(model,feats){
    if(!feats.length)return false;
    var keep=model.off;model.off={x:0,y:0};
    var xs=[],ys=[];
    feats.forEach(function(f){var p=predict(model,f);xs.push(p.x);ys.push(p.y);});
    var off={x:0.5-median(xs),y:0.5-median(ys)};
    if(Math.abs(off.x)>0.6||Math.abs(off.y)>0.6){model.off=keep;return false;}
    model.off=off;
    return true;
  }

  /* ---------- 부드럽게 하기, 칸 판정 ---------- */

  function OneEuro(minCut,beta,dCut){this.minCut=minCut;this.beta=beta;this.dCut=dCut||1;this.reset()}
  OneEuro.prototype.reset=function(){this.x=null;this.dx=0;this.t=0};
  OneEuro.prototype.filter=function(x,t){   /* t: 초 */
    if(this.x===null){this.x=x;this.dx=0;this.t=t;return x;}
    var dt=t-this.t;
    if(!(dt>0))return this.x;
    this.t=t;
    function alpha(cut){var tau=1/(2*Math.PI*cut);return 1/(1+tau/dt)}
    var dx=(x-this.x)/dt,ad=alpha(this.dCut);
    this.dx=this.dx+ad*(dx-this.dx);
    var a=alpha(this.minCut+this.beta*Math.abs(this.dx));
    this.x=this.x+a*(x-this.x);
    return this.x;
  };

  function zoneOf(x,y){
    var col=clamp(Math.floor(x*3),0,2),row=clamp(Math.floor(y*3),0,2);
    return row*3+col+1;
  }
  function zoneCenter(z){return {x:((z-1)%3+0.5)/3,y:(Math.floor((z-1)/3)+0.5)/3}}

  /* 새 칸에 ms 이상 머물러야 칸이 바뀝니다(경계에서 떨리지 않게). */
  function ZoneHold(ms){this.ms=ms;this.reset()}
  ZoneHold.prototype.reset=function(){this.z=null;this.c=null;this.ct=0};
  ZoneHold.prototype.update=function(z,t){
    if(z==null)return this.z;
    if(this.z===null){this.z=z;this.c=null;return z;}
    if(z===this.z){this.c=null;return this.z;}
    if(z!==this.c){this.c=z;this.ct=t;return this.z;}
    if(t-this.ct>=this.ms){this.z=z;this.c=null;}
    return this.z;
  };

  /* ---------- 깜빡임 ---------- */

  /* 감김 정도(0~1)가 on을 넘었다가 off 아래로 돌아오면 한 번.
     감고 있던 시간이 minMs~maxMs 안일 때만 의도한 깜빡임으로 봅니다.
     alarmMs 이상 감고 있으면 한 번 alarm을 알립니다(0이면 끔). */
  function BlinkDetector(o){
    o=o||{};
    this.on=o.on||0.5;this.off=o.off||0.35;
    this.minMs=o.minMs==null?200:o.minMs;this.maxMs=o.maxMs==null?1000:o.maxMs;
    this.alarmMs=o.alarmMs==null?3000:o.alarmMs;
    this.reset();
  }
  BlinkDetector.prototype.reset=function(){this.since=null;this.alarmed=false};
  BlinkDetector.prototype.update=function(c,t){
    var r={closed:false,blink:false,alarm:false,opened:false,dur:0};
    if(this.since===null){
      if(c>=this.on){this.since=t;this.alarmed=false;r.closed=true;}
      return r;
    }
    r.dur=t-this.since;
    if(c<=this.off){
      this.since=null;r.opened=true;
      r.blink=r.dur>=this.minMs&&r.dur<=this.maxMs;
      return r;
    }
    r.closed=true;
    if(this.alarmMs>0&&r.dur>=this.alarmMs&&!this.alarmed){this.alarmed=true;r.alarm=true;}
    return r;
  };

  /* ---------- 측정값 -> 시선 점, 칸, 깜빡임 ---------- */

  function Tracker(o){
    o=o||{};
    this.model=o.model||null;
    this.blink=new BlinkDetector(o.blink);
    this.hold=new ZoneHold(o.holdMs==null?150:o.holdMs);
    this.fx=new OneEuro(0.6,0.5);this.fy=new OneEuro(0.6,0.5);
    this.ear=new EarCloser();
    this.settleMs=o.settleMs==null?120:o.settleMs;
    this.reset();
  }
  Tracker.prototype.reset=function(){
    this.fx.reset();this.fy.reset();this.hold.reset();this.blink.reset();
    this.lastPt=null;this.lastZone=null;this.lastRaw=null;this.jump=false;
    this.lostSince=null;this.settleUntil=0;this.halfSince=null;
  };
  /* 감김 점수에서, 눈을 뜨고 있어도 나오는 만큼(c0, 아래를 볼 때 큽니다)을 뺍니다. */
  Tracker.prototype.closedOf=function(m){
    var c=m.closed==null?this.ear.update(m.open):m.closed,c0=this.model?this.model.c0||0:0;
    return clamp((c-c0)/(1-c0),0,1);
  };
  /* m: measure() 결과 또는 null. t: ms.
     돌려주는 값 {pt:{x,y}|null, zone, blink, alarm, closed, why}
     pt가 null이면 입력을 멈춰야 합니다. why: face 얼굴 놓침, closed 눈 감음, model 보정 없음, away 화면 밖 */
  Tracker.prototype.step=function(m,t){
    var out={pt:null,zone:null,blink:false,alarm:false,closed:false,why:""};
    if(!m){
      if(this.lostSince===null)this.lostSince=t;
      if(t-this.lostSince>1000){var keep=this.lostSince;this.reset();this.lostSince=keep;}
      out.why="face";return out;
    }
    this.lostSince=null;
    var c=this.closedOf(m),b=this.blink.update(c,t);
    out.blink=b.blink;out.alarm=b.alarm;out.closed=b.closed;
    if(b.opened)this.settleUntil=t+this.settleMs;
    /* 감는 동안, 반쯤 감긴 동안, 막 뜬 직후에는 홍채가 흔들리므로 감기 직전 칸을 유지합니다. */
    if(b.closed&&b.dur>this.blink.maxMs){out.why="closed";return out;}
    /* 눈꺼풀이 반쯤 내려온 채로 오래 있으면(졸림, 눈꺼풀 처짐) 마지막 칸에 붙들어 두지 않고 멈춥니다. */
    if(!b.closed&&c>=this.blink.off){
      if(this.halfSince===null)this.halfSince=t;
      if(t-this.halfSince>this.blink.maxMs){this.lastPt=null;this.lastZone=null;this.hold.reset();out.why="closed";return out;}
    }else this.halfSince=null;
    if(b.closed||c>=this.blink.off||t<this.settleUntil){
      out.pt=this.lastPt;out.zone=this.lastZone;
      if(!out.pt)out.why="closed";
      return out;
    }
    if(!this.model){out.why="model";return out;}
    var p=predict(this.model,featureVec(m));
    /* 한 프레임만 크게 튄 값은 버립니다. 다음 프레임에도 그 근처면 진짜 시선 이동입니다. */
    if(this.lastRaw&&!this.jump&&dist(p,this.lastRaw)>0.45){
      this.jump=true;out.pt=this.lastPt;out.zone=this.lastZone;return out;
    }
    this.jump=false;this.lastRaw=p;
    var x=this.fx.filter(p.x,t/1000),y=this.fy.filter(p.y,t/1000);
    if(x<-0.3||x>1.3||y<-0.3||y>1.3){this.lastPt=null;this.lastZone=null;this.hold.reset();out.why="away";return out;}
    var pt={x:clamp(x,0,1),y:clamp(y,0,1)};
    this.lastPt=pt;this.lastZone=this.hold.update(zoneOf(pt.x,pt.y),t);
    out.pt=pt;out.zone=this.lastZone;
    return out;
  };

  /* ---------- 보정 점 하나에서 표본 모으기 ---------- */

  /* 환자는 버튼을 누를 수 없으므로, 눈동자가 한곳에 머물러 있으면 저절로 채워집니다. */
  function Collector(o){
    o=o||{};
    this.settleMs=o.settleMs==null?700:o.settleMs;   /* 점으로 눈을 옮길 시간 */
    this.need=o.need||24;this.win=o.win||6;this.tol=o.tol||0.03;
    this.start(0);
  }
  Collector.prototype.start=function(t){this.t0=t;this.buf=[];this.recent=[]};
  Collector.prototype.progress=function(){return Math.min(1,this.buf.length/this.need)};
  Collector.prototype.done=function(){return this.buf.length>=this.need};
  /* m: 측정값, c: 눈 감김(0~1 원래 점수) */
  Collector.prototype.update=function(m,c,t){
    if(this.done())return 1;
    if(!m||c>0.75){this.recent=[];return this.progress();}
    if(t-this.t0<this.settleMs)return 0;
    this.recent.push(m);if(this.recent.length>this.win)this.recent.shift();
    if(this.recent.length<this.win)return this.progress();
    function range(k,a){var lo=Infinity,hi=-Infinity;a.forEach(function(v){if(v[k]<lo)lo=v[k];if(v[k]>hi)hi=v[k];});return hi-lo}
    var spread=Math.max(range("hx",this.recent),range("hy",this.recent));
    /* 떨림이 큰 카메라에서도 끝나도록 기다릴수록 조금씩 너그러워집니다. */
    var tol=this.tol*Math.min(3,1+(t-this.t0-this.settleMs)/3000);
    if(spread>tol*3){this.buf=[];return 0;}          /* 눈을 다른 데로 돌렸음 */
    if(spread<=tol)this.buf.push({f:featureVec(m),c:c,m:m});
    return this.progress();
  };

  /* 조건이 ms 동안 이어져야 통과 */
  function HoldGate(ms){this.ms=ms;this.since=null}
  HoldGate.prototype.update=function(ok,t){
    if(!ok){this.since=null;return 0;}
    if(this.since===null)this.since=t;
    return Math.min(1,(t-this.since)/this.ms);
  };

  /* ---------- 자세 점검, 품질, 태블릿 옮김 ---------- */

  var LIMIT={distMin:35,distMax:70,angle:25,light:45};

  /* m: 측정값 또는 null. light: 눈 주변 밝기(0~255) 또는 null(아직 모름)
     돌려주는 값 {ok, items:{face,dist,angle,eyes,light}, msg} — msg는 보호자에게 보여 줄 말 */
  function postureCheck(m,light){
    var it={face:false,dist:false,angle:false,eyes:false,light:false};
    if(!m)return {ok:false,items:it,msg:"얼굴이 보이지 않습니다. 태블릿을 얼굴 쪽으로 돌려 주세요"};
    var bx=(m.box.x0+m.box.x1)/2,by=(m.box.y0+m.box.y1)/2,dx=bx-0.5,dy=by-0.5;
    var off=Math.abs(dx)>0.2||Math.abs(dy)>0.22;
    it.light=light==null||light>=LIMIT.light;
    it.face=!m.cut&&!off;
    it.dist=m.distCm>=LIMIT.distMin&&m.distCm<=LIMIT.distMax;
    it.angle=Math.abs(m.yaw)<=LIMIT.angle&&Math.abs(m.pitch)<=LIMIT.angle&&Math.abs(m.roll)<=LIMIT.angle;
    it.eyes=m.eyes===2;
    var msg="좋습니다. 그대로 계세요";
    if(!it.light)msg="얼굴 쪽을 더 밝게 해 주세요";
    else if(!it.face){
      if(!off&&m.distCm<LIMIT.distMin+10)msg="조금 더 멀리 놓아 주세요";
      else if(Math.abs(dx)>=Math.abs(dy))msg=dx<0?"태블릿을 왼쪽으로 옮겨 주세요":"태블릿을 오른쪽으로 옮겨 주세요";
      else msg=dy<0?"태블릿을 위로 옮겨 주세요":"태블릿을 아래로 옮겨 주세요";
    }
    else if(!it.dist)msg=m.distCm<LIMIT.distMin?"조금 더 멀리 놓아 주세요":"조금 더 가까이 놓아 주세요";
    else if(!it.angle)msg=Math.abs(m.roll)>LIMIT.angle?"태블릿을 얼굴 기울기에 맞춰 돌려 주세요":"태블릿이 얼굴을 똑바로 마주 보게 돌려 주세요";
    else if(!it.eyes)msg="두 눈이 다 보이게 해 주세요";
    return {ok:it.face&&it.dist&&it.angle&&it.eyes&&it.light,items:it,msg:msg};
  }

  /* q: {irisPx, fps, light}. level: good 좋음, low 쓸 수는 있음, bad 9칸 구분이 어려움 */
  function quality(q){
    var msg="",level="good";
    if(q.light!=null&&q.light<LIMIT.light){msg="얼굴 쪽을 더 밝게 해 주세요";level="low";}
    else if(q.irisPx<7){msg="조금 더 가까이 놓아 주세요";level="low";}
    else if(q.fps>0&&q.fps<8){msg="기기가 느려 시선이 늦게 따라옵니다";level="low";}
    if(q.irisPx<5||(q.fps>0&&q.fps<5)||(q.light!=null&&q.light<25))level="bad";
    return {level:level,msg:msg};
  }
  /* 저사양 기기면 모델 실행을 초당 15회쯤으로 낮춥니다. */
  function needsLowRate(inferMs,fps){return inferMs>40||(fps>0&&fps<18)}

  function FpsMeter(){this.t=null;this.fps=0}
  FpsMeter.prototype.update=function(t){
    if(this.t!==null&&t>this.t){var f=1000/(t-this.t);this.fps=this.fps?this.fps*0.9+f*0.1:f;}
    this.t=t;return this.fps;
  };

  /* 보정이 끝났을 때의 자세. 태블릿이 옮겨졌는지 볼 때 기준이 됩니다. */
  function baselineOf(ms){
    function med(k){return median(ms.map(function(m){return m[k]}))}
    return {ex:med("ex"),ey:med("ey"),distCm:med("distCm"),yaw:med("yaw"),pitch:med("pitch"),roll:med("roll")};
  }
  function MoveDetector(base,o){
    o=o||{};
    this.base=base;this.ms=o.ms||1200;this.since=null;
    this.pos=o.pos||0.12;this.dist=o.dist||0.25;this.angle=o.angle||15;
  }
  MoveDetector.prototype.update=function(m,t){
    if(!m||!this.base)return false;
    var b=this.base;
    var far=Math.abs(m.ex-b.ex)>this.pos||Math.abs(m.ey-b.ey)>this.pos||
      Math.abs(m.distCm/b.distCm-1)>this.dist||
      Math.abs(m.yaw-b.yaw)>this.angle||Math.abs(m.pitch-b.pitch)>this.angle||Math.abs(m.roll-b.roll)>this.angle;
    if(!far){this.since=null;return false;}
    if(this.since===null)this.since=t;
    return t-this.since>=this.ms;
  };

  return {
    EYE:EYE,IRIS_MM:IRIS_MM,LIMIT:LIMIT,
    clamp:clamp,median:median,majority:majority,
    measure:measure,anglesOf:anglesOf,EarCloser:EarCloser,
    featureVec:featureVec,ridgeFit:ridgeFit,predict:predict,biasFix:biasFix,
    OneEuro:OneEuro,zoneOf:zoneOf,zoneCenter:zoneCenter,ZoneHold:ZoneHold,
    BlinkDetector:BlinkDetector,Tracker:Tracker,
    Collector:Collector,HoldGate:HoldGate,
    postureCheck:postureCheck,quality:quality,needsLowRate:needsLowRate,FpsMeter:FpsMeter,
    baselineOf:baselineOf,MoveDetector:MoveDetector
  };
});
