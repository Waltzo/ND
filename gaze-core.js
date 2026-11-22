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

  /* 얼굴 변환 행렬(4x4)에서 머리 각도(도). 행렬이 없으면 null
     yaw: 얼굴이 (뒤집은 화면의) 오른쪽으로 돌면 +, pitch: 얼굴이 아래로 숙여지면 +
     부호는 고개를 돌린 실제 얼굴 사진을 모델에 넣어 코 위치, 깊이값과 맞는지 확인했습니다. */
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
      ang={yaw:clamp(along*90,-60,60),pitch:clamp((down-0.55)*90,-60,60)};
    }
    /* 기울임: 두 눈을 잇는 선의 각도(뒤집은 화면에서 시계 방향이 +). 랜드마크에서 바로 구합니다.
       홍채 위치는 눈꼬리 축(머리와 같이 기우는 축) 기준이므로, 이 각도만큼 돌려 화면 축 기준으로 바꿉니다.
       이렇게 해야 머리가 기울어도 "화면에서 오른쪽, 아래"가 같은 뜻을 가집니다. */
    var rho=Math.atan2(R.c.y-L.c.y,R.c.x-L.c.x),cr=Math.cos(rho),sr=Math.sin(rho);
    var hx=avg("hx"),hy=avg("hy"),ly=avg("ly");
    var closed=null;
    if(o.blink)closed=both?Math.min(o.blink.l,o.blink.r):(use[0]===L?o.blink.l:o.blink.r);
    return {
      eyes:both?2:1,
      hx:hx,hy:hy,ly:ly,open:avg("open"),
      gx:hx*cr-hy*sr,gy:hx*sr+hy*cr,gl:hx*sr+ly*cr,      /* 화면 축 기준 홍채 위치(좌우, 상하), 눈꺼풀 높이 */
      irisPx:irisPx,distCm:irisPx>0?f*IRIS_MM/irisPx/10:0,
      yaw:ang.yaw,pitch:ang.pitch,roll:rho*180/Math.PI,
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
  function featureVec(m){return [m.gx,m.gy,m.gl,m.yaw,m.pitch,m.roll,m.ex,m.ey]}
  /* 보정하는 동안 거의 변하지 않는 값이 부풀려지지 않게 하는 최소 폭 */
  var SD_FLOOR=[0.01,0.01,0.01,4,4,4,0.04,0.04];
  /* 머리 쪽 값은 보정 중에 조금밖에 안 움직여 우연히 맞춰지기 쉬우므로 더 세게 누릅니다. */
  var PENALTY=[1,1,1,1000,1000,20,20,20];   /* 좌우, 상하 돌림은 회귀에 맡기지 않고 아래 headShift 로 보정합니다 */

  /* 머리 돌림 보정. 같은 곳을 보면서 머리만 돌리면 눈은 머리 안에서 반대로 돕니다.
     홍채 위치(눈 너비 기준)는 눈이 1라디안 돌 때 HEAD_K 만큼 움직입니다. 실제 얼굴 사진으로 재 보면
     완만한 각도에서 0.32~0.39 였습니다. 보정 때 배운 "홍채 위치당 화면 이동"에 이 값을 곱하면
     머리가 1도 돌 때 시선이 화면에서 얼마나 움직이는지 나옵니다. 상하는 화면의 가로세로 비로 환산합니다. */
  var HEAD_K=0.35,HEAD_MAX=30;
  function headShift(model,f){
    var g=model.wx[0]/model.sd[0];                     /* 홍채 좌우 위치 1당 화면 좌우 이동 */
    if(model.head===false||!(g>0))return {x:0,y:0};
    var k=g*HEAD_K*Math.PI/180;
    return {
      x:k*clamp(f[3]-model.mean[3],-HEAD_MAX,HEAD_MAX),
      y:k*(model.aspect||1.5)*clamp(f[4]-model.mean[4],-HEAD_MAX,HEAD_MAX)
    };
  }

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
  /* aspect: 자판 영역의 가로/세로 비(머리 상하 돌림을 화면 세로 이동으로 환산할 때 씁니다) */
  function ridgeFit(samples,lambda,aspect){
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
    var model={mean:mean,sd:sd,wx:wx,wy:wy,bx:bx,by:by,off:{x:0,y:0},c0:0,rms:0,aspect:aspect||1.5};
    var e=0;
    for(i=0;i<n;i++){var p=predict(model,samples[i].f);e+=Math.pow(p.x-samples[i].x,2)+Math.pow(p.y-samples[i].y,2);}
    model.rms=Math.sqrt(e/n);
    return model;
  }
  function predict(model,f){
    var x=model.bx+model.off.x,y=model.by+model.off.y,j,z;
    for(j=0;j<f.length;j++){z=(f[j]-model.mean[j])/model.sd[j];x+=model.wx[j]*z;y+=model.wy[j]*z;}
    var h=headShift(model,f);
    return {x:x+h.x,y:y+h.y};
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
    this.longMs=o.longMs==null?2500:o.longMs;   /* 길게 깜빡임으로 치는 가장 긴 시간 */
    this.longAnywhere=!!o.longAnywhere;         /* 시선 자리가 없어도 길게 깜빡임을 읽을지 */
    this.away=o.away==null?0.3:o.away;          /* 화면 밖으로 이만큼(화면 크기 기준) 넘게 나가면 입력을 멈춤 */
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
     돌려주는 값 {pt:{x,y}|null, zone, blink, long, alarm, closed, why}
     long: 깜빡임보다 길게(maxMs 초과, longMs 이하) 감았다 떴음
     pt가 null이면 입력을 멈춰야 합니다. why: face 얼굴 놓침, closed 눈 감음, model 보정 없음, away 화면 밖 */
  Tracker.prototype.step=function(m,t){
    var out={pt:null,zone:null,blink:false,long:false,alarm:false,closed:false,why:""};
    if(!m){
      if(this.lostSince===null)this.lostSince=t;
      if(t-this.lostSince>1000){var keep=this.lostSince;this.reset();this.lostSince=keep;}
      out.why="face";return out;
    }
    this.lostSince=null;
    var c=this.closedOf(m),b=this.blink.update(c,t);
    out.blink=b.blink;out.alarm=b.alarm;out.closed=b.closed;
    if(b.opened){
      this.settleUntil=t+this.settleMs;
      /* longAnywhere: 깜빡임 횟수 방식처럼 어느 칸을 보는지가 필요 없을 때는 시선 자리가 없어도 읽습니다 */
      out.long=b.dur>this.blink.maxMs&&b.dur<=this.longMs&&(!!this.longAnywhere||!!this.lastPt);
    }
    /* 감는 동안, 반쯤 감긴 동안, 막 뜬 직후에는 홍채가 흔들리므로 감기 직전 칸을 유지합니다. */
    /* 길게 깜빡임을 읽으려면 그 시간까지는 감기 직전 칸을 붙들고 있어야 합니다. */
    if(b.closed&&b.dur>Math.max(this.blink.maxMs,this.longMs)){out.why="closed";return out;}
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
    var aw=this.away;
    if(x<-aw||x>1+aw||y<-aw||y>1+aw){this.lastPt=null;this.lastZone=null;this.hold.reset();out.why="away";return out;}
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

  /* 거리는 cm 가 아니라 홍채가 몇 픽셀로 찍히는지로 봅니다. 카메라 화각과 줌에 따라 같은 거리라도
     찍히는 크기가 달라서, 실제로 눈을 읽을 수 있는지는 픽셀 수가 말해 줍니다. */
  var LIMIT={irisMin:8,angle:25,light:45};

  /* m: 측정값 또는 null. light: 눈 주변 밝기(0~255) 또는 null(아직 모름)
     돌려주는 값 {ok, items:{face,dist,angle,eyes,light}, msg} — msg는 보호자에게 보여 줄 말 */
  function postureCheck(m,light){
    var it={face:false,dist:false,angle:false,eyes:false,light:false};
    if(!m)return {ok:false,items:it,msg:"얼굴이 보이지 않습니다. 태블릿을 얼굴 쪽으로 돌려 주세요"};
    var bx=(m.box.x0+m.box.x1)/2,by=(m.box.y0+m.box.y1)/2,dx=bx-0.5,dy=by-0.5;
    /* 얼굴은 잘라서 한가운데로 옮겨 읽으므로, 영상 가장자리에 너무 붙었을 때만 옮겨 달라고 합니다. */
    var off=Math.abs(dx)>0.38||Math.abs(dy)>0.38;
    it.light=light==null||light>=LIMIT.light;
    it.face=!m.cut&&!off;
    /* 너무 가까움: 얼굴이 화면을 거의 다 채움 */
    var big=(m.box.x1-m.box.x0)>0.7||(m.box.y1-m.box.y0)>0.85;
    it.dist=m.irisPx>=LIMIT.irisMin&&!big;
    it.angle=Math.abs(m.yaw)<=LIMIT.angle&&Math.abs(m.pitch)<=LIMIT.angle&&Math.abs(m.roll)<=LIMIT.angle;
    it.eyes=m.eyes===2;
    var msg="좋습니다. 그대로 계세요";
    if(!it.light)msg="얼굴 쪽을 더 밝게 해 주세요";
    else if(!it.face){
      if(!off||big)msg="조금 더 멀리 놓아 주세요";
      else if(Math.abs(dx)>=Math.abs(dy))msg=dx<0?"태블릿을 왼쪽으로 옮겨 주세요":"태블릿을 오른쪽으로 옮겨 주세요";
      else msg=dy<0?"태블릿을 위로 옮겨 주세요":"태블릿을 아래로 옮겨 주세요";
    }
    else if(!it.dist)msg=big?"조금 더 멀리 놓아 주세요":"조금 더 가까이 놓아 주세요";
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

  /* ---------- 먼 얼굴 찾기: 영상을 잘라 키워서 읽기 ---------- */

  /* 얼굴이 작게 찍히면 화면 전체로는 못 찾습니다. 화면을 겹치는 조각으로 나눠 하나씩 넣어 봅니다.
     돌려주는 값: 차례로 넣어 볼 범위들. null 은 화면 전체, 가운데에 가까운 조각부터 */
  function searchRegions(vw,vh){
    var out=[null],levels=vw>=2500?[2,3,4]:[2,3];
    levels.forEach(function(L){
      var w=vw/L,h=vh/L,n=2*L-1,part=[],i,j;
      for(j=0;j<n;j++)for(i=0;i<n;i++)part.push({x:i*w/2,y:j*h/2,w:w,h:h});
      part.sort(function(a,b){
        function d(r){return Math.abs(r.x+r.w/2-vw/2)/vw+Math.abs(r.y+r.h/2-vh/2)/vh}
        return d(a)-d(b);
      });
      out=out.concat(part);
    });
    return out;
  }
  /* 찾은 얼굴(뒤집은 0~1 좌표의 box)이 한가운데 오는 정사각형 범위(원본 영상 픽셀).
     얼굴이 영상 가장자리에 있으면 범위가 영상 밖으로 나갑니다(그 부분은 빈 채로 둡니다).
     fw 는 얼굴 너비(픽셀), scale 은 얼굴 너비가 FACE_PX 가 되게 하는 확대 배율입니다. */
  var FACE_PX=400,CROP_MARGIN=1.5,CROP_MAX=1024;
  function cropAround(box,vw,vh){
    var x0=(1-box.x1)*vw,x1=(1-box.x0)*vw,y0=box.y0*vh,y1=box.y1*vh;
    var fw=Math.max(1,x1-x0),side=Math.max(fw,y1-y0)*CROP_MARGIN;
    var k=Math.min(FACE_PX/fw,CROP_MAX/side);            /* 그림이 너무 커지지 않게만 막습니다 */
    return {x:(x0+x1)/2-side/2,y:(y0+y1)/2-side/2,w:side,h:side,fw:fw,scale:k};
  }
  /* 읽은 얼굴이 말이 되는지. 잘라 넣은 범위(region, 없으면 화면 전체)에 비해 얼굴이 터무니없이 작거나,
     홍채와 눈 너비의 비율이 사람 눈과 동떨어지면 잘못 읽은 것으로 보고 버립니다. */
  function plausible(m,region,vw){
    var faceW=(m.box.x1-m.box.x0)*vw,ratio=m.irisPx/((m.R.w+m.L.w)/2);
    if(!(ratio>0.22&&ratio<0.75))return false;
    return faceW>=(region?region.w:vw)*0.04;
  }
  /* 범위를 조금씩 따라 움직이면 추적이 흔들리므로, 얼굴이 꽤 벗어나거나 크기가 달라졌을 때만 새로 잡습니다. */
  function cropStale(cur,want){
    var dx=Math.abs((cur.x+cur.w/2)-(want.x+want.w/2)),dy=Math.abs((cur.y+cur.h/2)-(want.y+want.h/2)),r=want.w/cur.w;
    return dx>cur.w*0.12||dy>cur.h*0.12||r<0.8||r>1.25;
  }
  /* 자세 점검 중 카메라 조절: 홍채가 작으면 해상도를 올리고, 그래도 작으면 줌을 당깁니다.
     얼굴이 화면 끝에 닿으면 줌을 풉니다. s: {irisPx, box, cut, zoom, zoomMin, zoomMax, canRes}
     돌려주는 값: {res:true} 해상도 올리기, {zoom:값} 줌 바꾸기, null 그대로 */
  function tuneCamera(s){
    var bw=s.box.x1-s.box.x0,bh=s.box.y1-s.box.y0,hasZoom=s.zoomMax>s.zoomMin;
    var edge=s.cut||s.box.x0<0.04||s.box.x1>0.96||s.box.y0<0.04||s.box.y1>0.96;
    if(hasZoom&&s.zoom>s.zoomMin&&(edge||bw>0.6||bh>0.75))return {zoom:Math.max(s.zoomMin,s.zoom/1.3)};
    if(s.irisPx>=12)return null;
    if(s.canRes)return {res:true};
    if(hasZoom&&s.zoom<s.zoomMax&&!edge&&bw*1.3<0.5&&bh*1.3<0.65)return {zoom:Math.min(s.zoomMax,s.zoom*1.3)};
    return null;
  }

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
    this.pos=o.pos||0.12;this.dist=o.dist||0.25;this.angle=o.angle||25;   /* 머리 각도는 보정하므로 넉넉하게 */
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
    featureVec:featureVec,headShift:headShift,HEAD_K:HEAD_K,ridgeFit:ridgeFit,predict:predict,biasFix:biasFix,
    OneEuro:OneEuro,zoneOf:zoneOf,zoneCenter:zoneCenter,ZoneHold:ZoneHold,
    BlinkDetector:BlinkDetector,Tracker:Tracker,
    Collector:Collector,HoldGate:HoldGate,
    FACE_PX:FACE_PX,searchRegions:searchRegions,cropAround:cropAround,plausible:plausible,cropStale:cropStale,tuneCamera:tuneCamera,
    postureCheck:postureCheck,quality:quality,needsLowRate:needsLowRate,FpsMeter:FpsMeter,
    baselineOf:baselineOf,MoveDetector:MoveDetector
  };
});
