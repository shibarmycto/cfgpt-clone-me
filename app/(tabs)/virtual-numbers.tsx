import React, { useRef, useState } from "react";
import {
  StyleSheet,
  View,
  Platform,
  ActivityIndicator,
  Text,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";

const C = Colors.light;

const EDITOR_HTML = `
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<script src="https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.0/fabric.min.js"></script>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #0d1117; color: #e6edf3; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; overflow: hidden; height: 100vh; display: flex; flex-direction: column; }
.header { padding: 8px 12px; background: #161b22; border-bottom: 1px solid #30363d; display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.header h1 { font-size: 15px; font-weight: 700; background: linear-gradient(135deg, #00d4aa, #7c3aed); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.header .badge { font-size: 9px; background: #00d4aa22; color: #00d4aa; padding: 2px 6px; border-radius: 4px; font-weight: 600; }
.main { display: flex; flex: 1; overflow: hidden; }
.toolbar { width: 56px; background: #161b22; border-right: 1px solid #30363d; display: flex; flex-direction: column; align-items: center; padding: 8px 4px; gap: 4px; flex-shrink: 0; overflow-y: auto; }
.tool-btn { width: 44px; height: 44px; border: none; background: transparent; color: #8b949e; border-radius: 8px; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 16px; transition: all 0.15s; }
.tool-btn:hover { background: #21262d; color: #e6edf3; }
.tool-btn.active { background: #00d4aa22; color: #00d4aa; }
.tool-btn span { font-size: 7px; margin-top: 2px; font-weight: 500; }
.tool-btn.free-btn { background: linear-gradient(135deg, #7c3aed33, #00d4aa33); color: #00d4aa; border: 1px solid #00d4aa44; }
.tool-btn.free-btn:hover { background: linear-gradient(135deg, #7c3aed55, #00d4aa55); }
.divider { width: 32px; height: 1px; background: #30363d; margin: 4px 0; }
.canvas-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #0d1117; position: relative; overflow: hidden; }
.canvas-container { border: 1px solid #30363d; border-radius: 4px; box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: #8b949e; }
.empty-state .icon { font-size: 48px; opacity: 0.3; }
.empty-state p { font-size: 14px; }
.upload-btn { padding: 10px 24px; background: linear-gradient(135deg, #00d4aa, #00b894); color: #0d1117; border: none; border-radius: 8px; font-size: 14px; font-weight: 700; cursor: pointer; }
.upload-btn:hover { opacity: 0.9; }
.bottom-bar { padding: 8px 12px; background: #161b22; border-top: 1px solid #30363d; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; gap: 8px; }
.bottom-bar button { padding: 6px 16px; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; }
.btn-cancel { background: #21262d; color: #8b949e; }
.btn-cancel:hover { background: #30363d; }
.btn-download { background: linear-gradient(135deg, #00d4aa, #00b894); color: #0d1117; }
.btn-download:hover { opacity: 0.9; }
.btn-download:disabled { opacity: 0.4; cursor: not-allowed; }
.panel { position: absolute; top: 8px; right: 8px; background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px; width: 200px; display: none; z-index: 10; }
.panel.show { display: block; }
.panel h3 { font-size: 12px; margin-bottom: 8px; color: #00d4aa; }
.panel label { font-size: 11px; color: #8b949e; display: block; margin-top: 6px; }
.panel input[type=range] { width: 100%; margin-top: 2px; accent-color: #00d4aa; }
.panel input[type=color] { width: 100%; height: 28px; border: none; background: transparent; cursor: pointer; }
.panel .filter-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 6px; }
.panel .filter-opt { padding: 4px 6px; background: #21262d; border: 1px solid #30363d; border-radius: 4px; color: #e6edf3; font-size: 10px; cursor: pointer; text-align: center; }
.panel .filter-opt:hover, .panel .filter-opt.active { border-color: #00d4aa; color: #00d4aa; }
.overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: none; z-index: 100; align-items: center; justify-content: center; flex-direction: column; gap: 12px; }
.overlay.show { display: flex; }
.overlay .spinner { width: 40px; height: 40px; border: 3px solid #30363d; border-top-color: #00d4aa; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.overlay p { color: #e6edf3; font-size: 14px; }
.status { font-size: 11px; color: #8b949e; }
input[type=file] { display: none; }
</style>
</head>
<body>
<div class="header">
  <h1>CFGPT Editor</h1>
  <div class="badge">FREE</div>
  <div style="flex:1"></div>
  <div class="status" id="status">Ready</div>
</div>
<div class="main">
  <div class="toolbar">
    <button class="tool-btn" id="uploadBtn" title="Upload Image" onclick="document.getElementById('fileInput').click()">
      <span style="font-size:18px">&#x1F4E4;</span><span>Upload</span>
    </button>
    <div class="divider"></div>
    <button class="tool-btn" id="cropBtn" onclick="toggleCrop()" title="Crop">
      <span style="font-size:18px">&#x2702;</span><span>Crop</span>
    </button>
    <button class="tool-btn" onclick="rotateImage()" title="Rotate">
      <span style="font-size:18px">&#x21BB;</span><span>Rotate</span>
    </button>
    <button class="tool-btn" onclick="flipH()" title="Flip">
      <span style="font-size:18px">&#x21C4;</span><span>Flip</span>
    </button>
    <div class="divider"></div>
    <button class="tool-btn" onclick="showPanel('adjustPanel')" title="Adjust">
      <span style="font-size:18px">&#x2600;</span><span>Adjust</span>
    </button>
    <button class="tool-btn" onclick="showPanel('filterPanel')" title="Filters">
      <span style="font-size:18px">&#x1F3A8;</span><span>Filters</span>
    </button>
    <button class="tool-btn" onclick="addText()" title="Text">
      <span style="font-size:18px">T</span><span>Text</span>
    </button>
    <div class="divider"></div>
    <button class="tool-btn free-btn" onclick="removeBackground()" title="Remove Background (FREE)">
      <span style="font-size:18px">&#x2728;</span><span>Rm BG</span>
    </button>
    <div class="divider"></div>
    <button class="tool-btn" onclick="undoAction()" title="Undo">
      <span style="font-size:18px">&#x21A9;</span><span>Undo</span>
    </button>
    <button class="tool-btn" onclick="redoAction()" title="Redo">
      <span style="font-size:18px">&#x21AA;</span><span>Redo</span>
    </button>
    <button class="tool-btn" onclick="deleteSelected()" title="Delete">
      <span style="font-size:18px">&#x1F5D1;</span><span>Delete</span>
    </button>
  </div>
  <div class="canvas-wrap" id="canvasWrap">
    <div class="empty-state" id="emptyState">
      <div class="icon">&#x1F5BC;</div>
      <p>Upload an image to start editing</p>
      <button class="upload-btn" onclick="document.getElementById('fileInput').click()">Choose Image</button>
      <p style="font-size:11px;margin-top:4px">PNG, JPG, WebP up to 10MB</p>
    </div>
    <canvas id="c" style="display:none"></canvas>
    <div class="panel" id="adjustPanel">
      <h3>Adjustments</h3>
      <label>Brightness <input type="range" min="-100" max="100" value="0" id="brightness" oninput="applyAdjust()"></label>
      <label>Contrast <input type="range" min="-100" max="100" value="0" id="contrast" oninput="applyAdjust()"></label>
      <label>Saturation <input type="range" min="-100" max="100" value="0" id="saturation" oninput="applyAdjust()"></label>
      <button class="filter-opt" onclick="resetAdjust()" style="margin-top:8px;width:100%">Reset</button>
    </div>
    <div class="panel" id="filterPanel">
      <h3>Filters</h3>
      <div class="filter-grid">
        <div class="filter-opt" onclick="applyFilter('none')">None</div>
        <div class="filter-opt" onclick="applyFilter('grayscale')">B&W</div>
        <div class="filter-opt" onclick="applyFilter('sepia')">Sepia</div>
        <div class="filter-opt" onclick="applyFilter('invert')">Invert</div>
        <div class="filter-opt" onclick="applyFilter('vintage')">Vintage</div>
        <div class="filter-opt" onclick="applyFilter('blur')">Blur</div>
      </div>
    </div>
  </div>
</div>
<div class="bottom-bar">
  <button class="btn-cancel" onclick="clearCanvas()">Clear</button>
  <div style="flex:1"></div>
  <button class="btn-download" id="dlBtn" onclick="downloadImage()" disabled>Download PNG</button>
  <button class="btn-download" onclick="downloadJPG()" id="dlJpg" disabled style="background:#7c3aed">Download JPG</button>
</div>
<div class="overlay" id="overlay">
  <div class="spinner"></div>
  <p id="overlayText">Processing...</p>
</div>
<input type="file" id="fileInput" accept="image/png,image/jpeg,image/webp" onchange="handleFile(event)">
<script>
var canvas, history=[], historyIdx=-1, hasImage=false, mainImg=null;

function init(){
  var wrap=document.getElementById('canvasWrap');
  var w=wrap.clientWidth-20, h=wrap.clientHeight-20;
  canvas=new fabric.Canvas('c',{width:Math.min(w,800),height:Math.min(h,600),backgroundColor:'#1a1a2e'});
  canvas.on('object:modified',saveState);
}
init();

function setStatus(t){document.getElementById('status').textContent=t;}
function showOverlay(t){document.getElementById('overlayText').textContent=t;document.getElementById('overlay').classList.add('show');}
function hideOverlay(){document.getElementById('overlay').classList.remove('show');}

function showPanel(id){
  document.querySelectorAll('.panel').forEach(function(p){
    if(p.id===id) p.classList.toggle('show');
    else p.classList.remove('show');
  });
}

function handleFile(e){
  var file=e.target.files[0];
  if(!file) return;
  if(file.size>10*1024*1024){alert('File too large. Max 10MB.');return;}
  var reader=new FileReader();
  reader.onload=function(ev){
    fabric.Image.fromURL(ev.target.result,function(img){
      canvas.clear();
      var scale=Math.min((canvas.width-40)/img.width,(canvas.height-40)/img.height,1);
      img.set({scaleX:scale,scaleY:scale,left:canvas.width/2,top:canvas.height/2,originX:'center',originY:'center'});
      canvas.add(img);
      canvas.setActiveObject(img);
      canvas.renderAll();
      mainImg=img;
      hasImage=true;
      document.getElementById('emptyState').style.display='none';
      document.getElementById('c').style.display='block';
      document.getElementById('dlBtn').disabled=false;
      document.getElementById('dlJpg').disabled=false;
      setStatus('Image loaded');
      saveState();
    });
  };
  reader.readAsDataURL(file);
  e.target.value='';
}

function saveState(){
  historyIdx++;
  history=history.slice(0,historyIdx);
  history.push(JSON.stringify(canvas.toJSON()));
  if(history.length>30)history.shift(),historyIdx--;
}
function undoAction(){
  if(historyIdx>0){historyIdx--;canvas.loadFromJSON(history[historyIdx],function(){canvas.renderAll();});}
}
function redoAction(){
  if(historyIdx<history.length-1){historyIdx++;canvas.loadFromJSON(history[historyIdx],function(){canvas.renderAll();});}
}

function rotateImage(){
  var obj=canvas.getActiveObject()||mainImg;
  if(obj){obj.rotate((obj.angle||0)+90);canvas.renderAll();saveState();setStatus('Rotated 90°');}
}
function flipH(){
  var obj=canvas.getActiveObject()||mainImg;
  if(obj){obj.set('flipX',!obj.flipX);canvas.renderAll();saveState();setStatus('Flipped');}
}
function deleteSelected(){
  var obj=canvas.getActiveObject();
  if(obj){canvas.remove(obj);canvas.renderAll();saveState();setStatus('Deleted');}
}

function addText(){
  var t=new fabric.IText('Edit me',{left:canvas.width/2,top:canvas.height/2,originX:'center',originY:'center',fontSize:28,fill:'#ffffff',fontFamily:'Arial',shadow:'0 2px 4px rgba(0,0,0,0.5)'});
  canvas.add(t);canvas.setActiveObject(t);canvas.renderAll();saveState();setStatus('Text added');
}

function applyAdjust(){
  if(!mainImg) return;
  var b=parseInt(document.getElementById('brightness').value)/100;
  var c=parseInt(document.getElementById('contrast').value)/100;
  var s=parseInt(document.getElementById('saturation').value)/100;
  var filters=[];
  if(b!==0) filters.push(new fabric.Image.filters.Brightness({brightness:b}));
  if(c!==0) filters.push(new fabric.Image.filters.Contrast({contrast:c}));
  if(s!==0) filters.push(new fabric.Image.filters.Saturation({saturation:s}));
  mainImg.filters=filters;
  mainImg.applyFilters();
  canvas.renderAll();
  setStatus('Adjusted');
}
function resetAdjust(){
  document.getElementById('brightness').value=0;
  document.getElementById('contrast').value=0;
  document.getElementById('saturation').value=0;
  if(mainImg){mainImg.filters=[];mainImg.applyFilters();canvas.renderAll();}
  setStatus('Reset');
}

function applyFilter(name){
  if(!mainImg) return;
  var f=[];
  if(name==='grayscale') f=[new fabric.Image.filters.Grayscale()];
  else if(name==='sepia') f=[new fabric.Image.filters.Sepia()];
  else if(name==='invert') f=[new fabric.Image.filters.Invert()];
  else if(name==='vintage') f=[new fabric.Image.filters.Sepia(),new fabric.Image.filters.Brightness({brightness:0.05}),new fabric.Image.filters.Contrast({contrast:0.1})];
  else if(name==='blur') f=[new fabric.Image.filters.Blur({blur:0.15})];
  mainImg.filters=f;
  mainImg.applyFilters();
  canvas.renderAll();
  saveState();
  setStatus('Filter: '+name);
  document.getElementById('filterPanel').classList.remove('show');
}

var cropMode=false,cropRect=null;
function toggleCrop(){
  if(!hasImage) return;
  if(!cropMode){
    cropRect=new fabric.Rect({left:canvas.width*0.15,top:canvas.height*0.15,width:canvas.width*0.7,height:canvas.height*0.7,fill:'rgba(0,212,170,0.1)',stroke:'#00d4aa',strokeWidth:2,strokeDashArray:[5,5],cornerColor:'#00d4aa',cornerSize:10,transparentCorners:false,hasRotatingPoint:false});
    canvas.add(cropRect);canvas.setActiveObject(cropRect);canvas.renderAll();
    cropMode=true;document.getElementById('cropBtn').classList.add('active');setStatus('Drag crop area, click Crop again to apply');
  } else {
    if(cropRect){
      var left=cropRect.left,top=cropRect.top,w=cropRect.width*cropRect.scaleX,h=cropRect.height*cropRect.scaleY;
      canvas.remove(cropRect);
      var dataUrl=canvas.toDataURL({left:left,top:top,width:w,height:h,format:'png'});
      canvas.clear();
      fabric.Image.fromURL(dataUrl,function(img){
        canvas.setWidth(w);canvas.setHeight(h);
        img.set({left:0,top:0});canvas.add(img);mainImg=img;canvas.renderAll();saveState();
      });
    }
    cropMode=false;cropRect=null;document.getElementById('cropBtn').classList.remove('active');setStatus('Cropped');
  }
}

function removeBackground(){
  if(!mainImg){alert('Upload an image first');return;}
  showOverlay('Removing background (client-side)...');
  setStatus('Processing...');
  try{
    var origUrl=mainImg.toDataURL({format:'png'});
    var img=new Image();
    img.crossOrigin='anonymous';
    img.onload=function(){
      var cv=document.createElement('canvas');
      cv.width=img.width;cv.height=img.height;
      var ctx=cv.getContext('2d');
      ctx.drawImage(img,0,0);
      var data=ctx.getImageData(0,0,cv.width,cv.height);
      var d=data.data;
      var bgR=d[0],bgG=d[1],bgB=d[2];
      var corners=[[0,0],[cv.width-1,0],[0,cv.height-1],[cv.width-1,cv.height-1]];
      var samples=[];
      corners.forEach(function(c){var i=(c[1]*cv.width+c[0])*4;samples.push([d[i],d[i+1],d[i+2]]);});
      bgR=Math.round(samples.reduce(function(s,c){return s+c[0];},0)/4);
      bgG=Math.round(samples.reduce(function(s,c){return s+c[1];},0)/4);
      bgB=Math.round(samples.reduce(function(s,c){return s+c[2];},0)/4);
      var threshold=45;
      for(var i=0;i<d.length;i+=4){
        var dr=d[i]-bgR,dg=d[i+1]-bgG,db=d[i+2]-bgB;
        var dist=Math.sqrt(dr*dr+dg*dg+db*db);
        if(dist<threshold) d[i+3]=0;
        else if(dist<threshold+20) d[i+3]=Math.round(255*(dist-threshold)/20);
      }
      ctx.putImageData(data,0,0);
      var resultUrl=cv.toDataURL('image/png');
      fabric.Image.fromURL(resultUrl,function(newImg){
        var idx=canvas.getObjects().indexOf(mainImg);
        var props={left:mainImg.left,top:mainImg.top,scaleX:mainImg.scaleX,scaleY:mainImg.scaleY,angle:mainImg.angle,originX:mainImg.originX,originY:mainImg.originY};
        canvas.remove(mainImg);
        newImg.set(props);
        canvas.insertAt(newImg,idx);
        mainImg=newImg;
        canvas.setBackgroundColor('transparent',canvas.renderAll.bind(canvas));
        canvas.renderAll();saveState();
        hideOverlay();setStatus('Background removed');
      });
    };
    img.src=origUrl;
  }catch(e){hideOverlay();setStatus('Error: '+e.message);alert('Background removal failed');}
}

function clearCanvas(){
  if(!hasImage) return;
  if(confirm('Clear canvas and start over?')){
    canvas.clear();canvas.setBackgroundColor('#1a1a2e',canvas.renderAll.bind(canvas));
    hasImage=false;mainImg=null;history=[];historyIdx=-1;
    document.getElementById('emptyState').style.display='flex';
    document.getElementById('c').style.display='none';
    document.getElementById('dlBtn').disabled=true;
    document.getElementById('dlJpg').disabled=true;
    setStatus('Ready');
  }
}

function downloadImage(){
  var url=canvas.toDataURL({format:'png',multiplier:2});
  var a=document.createElement('a');a.download='cfgpt-edited.png';a.href=url;a.click();setStatus('Downloaded PNG');
}
function downloadJPG(){
  canvas.setBackgroundColor('#ffffff',function(){
    var url=canvas.toDataURL({format:'jpeg',quality:0.92,multiplier:2});
    var a=document.createElement('a');a.download='cfgpt-edited.jpg';a.href=url;a.click();
    canvas.setBackgroundColor('#1a1a2e',canvas.renderAll.bind(canvas));
    setStatus('Downloaded JPG');
  });
}

window.addEventListener('resize',function(){
  var wrap=document.getElementById('canvasWrap');
  var w=wrap.clientWidth-20,h=wrap.clientHeight-20;
  if(!hasImage){canvas.setWidth(Math.min(w,800));canvas.setHeight(Math.min(h,600));}
});
</script>
</body>
</html>
`;

export default function CFGPTEditorScreen() {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const isWeb = Platform.OS === "web";

  if (isWeb) {
    return (
      <View style={[styles.container, { paddingTop: insets.top > 0 ? insets.top : 67 }]}>
        <iframe
          srcDoc={EDITOR_HTML}
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            borderRadius: 0,
          } as any}
          onLoad={() => setLoading(false)}
        />
        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={C.tint} />
            <Text style={styles.loadingText}>Loading Editor...</Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.nativeHeader}>
        <View style={styles.headerRow}>
          <Ionicons name="brush" size={22} color={C.tint} />
          <Text style={styles.headerTitle}>CFGPT Editor</Text>
          <View style={styles.freeBadge}>
            <Text style={styles.freeBadgeText}>FREE</Text>
          </View>
        </View>
        <Text style={styles.headerSub}>
          Open in browser for full image editing with background removal
        </Text>
      </View>
      <View style={styles.nativeBody}>
        <Ionicons name="desktop-outline" size={56} color={C.textTertiary} />
        <Text style={styles.nativeTitle}>Image Editor</Text>
        <Text style={styles.nativeDesc}>
          The CFGPT Editor works best in a web browser where you can upload,
          edit, crop, add filters, remove backgrounds, and download your images.
        </Text>
        <Text style={styles.nativeHint}>
          Scan the QR code or open the web version to use the full editor.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0d1117",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0d1117",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: {
    color: C.textSecondary,
    fontSize: 14,
  },
  nativeHeader: {
    padding: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#30363d",
    backgroundColor: "#161b22",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700" as const,
    color: C.tint,
  },
  freeBadge: {
    backgroundColor: "#00d4aa22",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  freeBadgeText: {
    fontSize: 10,
    fontWeight: "700" as const,
    color: C.tint,
  },
  headerSub: {
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 4,
  },
  nativeBody: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  nativeTitle: {
    fontSize: 20,
    fontWeight: "700" as const,
    color: C.text,
  },
  nativeDesc: {
    fontSize: 14,
    color: C.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  nativeHint: {
    fontSize: 12,
    color: C.tint,
    textAlign: "center",
    marginTop: 8,
  },
});
