// ===== 1. الخريطة =====
const map = L.map("map").setView([24.7136, 46.6753], 11);

// طبقة الخريطة العادية
const osmLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap",
});

const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}');

osmLayer.addTo(map);

// زرار التبديل بين الطبقتين
L.control.layers(
  {
    "🗺️ خريطة عادية": osmLayer,
    "🛰️ قمر صناعي": satelliteLayer,
  },
  null,
  { position: "bottomleft" }

).addTo(map);


// ===== 2. الطبقات والحالة =====
const layers = {
  drawn: L.featureGroup().addTo(map),
  buffer: L.featureGroup().addTo(map),
  coverage: L.featureGroup().addTo(map),
};

// Cluster = بيجمع النقط القريبة في دايرة واحدة عشان الخريطة متبقاش زحمة
const clusterGroup = L.markerClusterGroup();
map.addLayer(clusterGroup);

const state = {
  lastDrawn: null,
  lastLocation: null,
  lastNearest: [],
  locationMode: false,
  routing: null,
};

// ===== 3. تعريف الخدمات في مكان واحد - عشان منكررش الكود =====
const SERVICES = [
  { file: "hospitals.geojson", type: "hospital", icon: "🏥", label: "مستشفى" },
  { file: "schools.geojson", type: "school", icon: "🏫", label: "مدرسة" },
  { file: "pharmacy.geojson", type: "pharmacy", icon: "💊", label: "صيدلية" },
  { file: "mosques.geojson", type: "mosque", icon: "🕌", label: "مسجد" },
];

let allServices = [];

// ===== 4. دوال مساعدة - بتتنده من كل حتة =====
// بنجيب الاسم من name أو name:ar أو name:en عشان الصيدليات والمساجد فيهم عربي
function getName(props) {
  return props.name || props["name:ar"] || props["name:en"] || "بدون اسم";
}
const toPoint = (lat, lng) => turf.point([lng, lat]);

const calcDistanceKm = (aLat, aLng, bLat, bLng) =>
  turf.distance(toPoint(aLat, aLng), toPoint(bLat, bLng), {
    units: "kilometers",
  });

// دالة واحدة لعمل Buffer - بتستخدم في التغطية والـ Buffer العادي
const createBuffer = (geojson, distKm, color = "#d32f2f") =>
  L.geoJSON(turf.buffer(geojson, distKm, { units: "kilometers" }), {
    style: { color, fillOpacity: 0.15, weight: 2 },
  });

// ===== 5. تحميل الداتا الحقيقية =====
async function loadRealData() {
  // بنحمل الـ 4 ملفات مع بعض - أسرع من واحد واحد
  const results = await Promise.all(
    SERVICES.map(async (s) => {
      try {
        const res = await fetch(s.file);
        if (!res.ok) return [];
        const data = await res.json();
        return data.features
          .filter((f) => f.geometry && f.geometry.type === "Point")
          .map((f) => {
            const [lng, lat] = f.geometry.coordinates;
            return {
              name: getName(f.properties),
              type: s.type,
              icon: s.icon,
              label: s.label,
              lat,
              lng,
            };
          });
      } catch (e) {
        console.log("ملف مش موجود: " + s.file);
        return [];
      }
    }),
  );

  allServices = results.flat();
  document.getElementById("loading").textContent =
    `✅ تم تحميل ${allServices.length} خدمة حقيقية من الرياض`;
  renderServices();
}

// ===== 6. عرض الخدمات =====
function getFiltered() {
  const f = document.getElementById("serviceType").value;
  return allServices.filter((s) => f === "all" || s.type === f);
}

function renderServices() {
  clusterGroup.clearLayers();
  const list = getFiltered();
  list.forEach((s) => {
    const m = L.marker([s.lat, s.lng], {
      icon: L.divIcon({
        html: `<span style="font-size:26px">${s.icon}</span>`,
        className: "",
      }),
    }).bindPopup(`<b>${s.icon} ${s.label}</b><br>${s.name}<br><a href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=driving" target="_blank" style="display:block; background:#1a73e8; color:white; text-align:center; padding:8px; border-radius:8px; margin-top:8px; text-decoration:none;">🧭 توجه زي جوجل ماب</a>`);
    clusterGroup.addLayer(m);
  });
  document.getElementById("serviceCount").textContent =
    `عدد الخدمات المعروضة: ${list.length}`;
}
document
  .getElementById("serviceType")
  .addEventListener("change", renderServices);

// ===== 7. البحث - متصلح مشكلة علامات التنصيص في الأسماء =====
document.getElementById("searchInput").addEventListener("input", (e) => {
  const q = e.target.value.trim();
  const box = document.getElementById("searchResults");
  if (!q) {
    box.innerHTML = "";
    return;
  }

  const results = allServices.filter((s) => s.name.includes(q)).slice(0, 10);
  box.innerHTML = "";
  results.forEach((s, i) => {
    const div = document.createElement("div");
    div.textContent = `${s.icon} ${s.name}`;
    div.onclick = () => {
      map.setView([s.lat, s.lng], 15);
      box.innerHTML = "";
    };
    box.appendChild(div);
  });
  if (!results.length) box.innerHTML = "<div>مفيش نتايج</div>";
});

// ===== 8. الرسم =====
const drawControl = new L.Control.Draw({
  edit: { featureGroup: layers.drawn },
  draw: {
    polygon: true,
    polyline: true,
    marker: true,
    rectangle: true,
    circle: false,
    circlemarker: false,
  },
});
map.addControl(drawControl);

map.on(L.Draw.Event.CREATED, (e) => {
  const layer = e.layer;
  layers.drawn.addLayer(layer);
  state.lastDrawn = layer;
  const geo = layer.toGeoJSON();
  if (e.layerType === "polyline")
    layer
      .bindPopup(
        `طول الخط: ${turf.length(geo, { units: "kilometers" }).toFixed(2)} كم`,
        
      )
      .openPopup();
  if (e.layerType === "polygon" || e.layerType === "rectangle")
    layer
      .bindPopup(`المساحة: ${(turf.area(geo) / 1000000).toFixed(2)} كم²`)
      .openPopup();
});

// ===== 9. Buffer =====
document.getElementById("bufferBtn").addEventListener("click", () => {
  if (!state.lastDrawn) return alert("ارسم شكل الأول");
  const meters = parseFloat(document.getElementById("bufferDist").value) || 500;
  createBuffer(state.lastDrawn.toGeoJSON(), meters / 1000).addTo(layers.buffer);
});


// ===== 10. اللوكيشن =====
document.getElementById("locationBtn").addEventListener("click", () => {
  state.locationMode = !state.locationMode;
  alert(
    state.locationMode
      ? "دوس على الخريطة عشان تحط لوكيشن"
      : "اتقفل وضع اللوكيشن",
  );
});
map.on("click", (e) => {
  if (!state.locationMode) return;
  L.marker(e.latlng).addTo(layers.drawn).bindPopup("📍 مكانك هنا").openPopup();
  state.lastLocation = e.latlng;
  state.locationMode = false;
});
document
  .getElementById("gpsBtn")
  .addEventListener("click", () => map.locate({ setView: true, maxZoom: 15 }));
map.on("locationfound", (e) => {
  state.lastLocation = e.latlng;
  L.marker(e.latlng).addTo(layers.drawn).bindPopup("أنت هنا").openPopup();
});
map.on("locationerror", () => alert("مش قادرين نجيب موقعك، فعل الـ GPS"));

// ===== 11. أقرب 3 + أقصر طريق =====
document.getElementById("nearestBtn").addEventListener("click", () => {
  if (!state.lastLocation) return alert("حط لوكيشن الأول");
  const sorted = getFiltered()
    .map((s) => ({
      ...s,
      dist: calcDistanceKm(
        state.lastLocation.lat,
        state.lastLocation.lng,
        s.lat,
        s.lng,
      ),
    }))
    .sort((a, b) => a.dist - b.dist);
  state.lastNearest = sorted.slice(0, 3);
  document.getElementById("nearestResult").innerHTML =
    "<b>أقرب 3:</b><br>" +
    state.lastNearest
      .map((s, i) => `${i + 1}. ${s.icon} ${s.name} - ${s.dist.toFixed(2)} كم`)
      .join("<br>");
});

document.getElementById("routeBtn").addEventListener("click", () => {
  if (!state.lastNearest.length) return alert("دوس أقرب 3 الأول");
  if (state.routing) map.removeControl(state.routing);
  const t = state.lastNearest[0];
  state.routing = L.Routing.control({
    waypoints: [
      L.latLng(state.lastLocation.lat, state.lastLocation.lng),
      L.latLng(t.lat, t.lng),
    ],
    router: L.Routing.osrmv1({
      serviceUrl: "https://router.project-osrm.org/route/v1",
    }),
    createMarker: () => null,
    show: false,
    addWaypoints: false,
    draggableWaypoints: false,
  }).addTo(map);
  state.routing.on("routesfound", (e) => {
    const r = e.routes[0].summary;
    document.getElementById("routeResult").innerHTML =
      `المسافة: ${(r.totalDistance / 1000).toFixed(2)} كم - الوقت: ${Math.round(r.totalTime / 60)} دقيقة`;
  });
});

// ===== 12. التغطية + التصدير + مسح الكل =====
document.getElementById("coverageBtn").addEventListener("click", () => {
  layers.coverage.clearLayers();
  
  // لو مفيش رسم، نبهه
  if (!state.lastDrawn) return alert("ارسم نقطة أو خط أو مساحة الأول");

  // نجيب المسافة من نفس خانة الـ Buffer اللي فوق
  const meters = parseFloat(document.getElementById("bufferDist").value) || 500;

  // نعمل تغطية حوالين الشكل المرسوم بس، مش حوالين الخدمات
  createBuffer(state.lastDrawn.toGeoJSON(), meters / 1000, "#00897b").addTo(layers.coverage);

  // لو راسم أكتر من شكل، نعمل تغطية لكل الأشكال المرسومة
  layers.drawn.eachLayer((layer) => {
    if (layer !== state.lastDrawn) {
      createBuffer(layer.toGeoJSON(), meters / 1000, "#00897b").addTo(layers.coverage);
    }
  });
});

// تحويل من Lat/Lon لـ UTM WGS84 - بيحسب الزون أوتوماتيك من خط الطول
// الرياض = 38N - تبوك وجدة = 37N
function latLngToUTM(lat, lng) {
  const a = 6378137, e = 0.081819191, k0 = 0.9996;
  const zone = Math.floor((lng + 180) / 6) + 1;
  const lonOrigin = (zone - 1) * 6 - 180 + 3;
  const latRad = lat * Math.PI / 180;
  const lngRad = lng * Math.PI / 180;
  const lonOriginRad = lonOrigin * Math.PI / 180;
  const e1sq = e * e / (1 - e * e);
  const N = a / Math.sqrt(1 - e * e * Math.sin(latRad) * Math.sin(latRad));
  const T = Math.tan(latRad) * Math.tan(latRad);
  const C = e1sq * Math.cos(latRad) * Math.cos(latRad);
  const A = Math.cos(latRad) * (lngRad - lonOriginRad);
  const M = a * ((1 - e*e/4 - 3*e**4/64 - 5*e**6/256) * latRad
    - (3*e*e/8 + 3*e**4/32 + 45*e**6/1024) * Math.sin(2*latRad)
    + (15*e**4/256 + 45*e**6/1024) * Math.sin(4*latRad)
    - (35*e**6/3072) * Math.sin(6*latRad));
  let easting = k0 * N * (A + (1-T+C) * A**3/6 + (5-18*T+T*T+72*C-58*e1sq) * A**5/120) + 500000;
  let northing = k0 * (M + N * Math.tan(latRad) * (A*A/2 + (5-T+9*C+4*C*C) * A**4/24 + (61-58*T+T*T+600*C-330*e1sq) * A**6/720));
  if (lat < 0) northing += 10000000;
  return { easting: Math.round(easting), northing: Math.round(northing), zone: zone + "N" };
}

document.getElementById("exportBtn").addEventListener("click", () => {
  if (!layers.drawn.getLayers().length) return alert("مفيش رسم عشان نصدره، ارسم الأول");

  let csv = "الاسم,نوع الرسم,خط العرض Lat,خط الطول Lon,UTM Easting متر,UTM Northing متر,UTM Zone,الطول بالكم,المساحة بالكم2,عدد النقط\n";
  let count = { point: 0, line: 0, area: 0 };

  layers.drawn.eachLayer((layer) => {
    const geo = layer.toGeoJSON();
    const geomType = geo.geometry.type;
    let name = "", type = "", latCol = "", lonCol = "", eastingCol = "", northingCol = "", zoneCol = "", length = "", area = "", pointCount = "";

    // بتجمع إحداثيات كل نقط الشكل: جغرافي + UTM
    const collect = (coordsList) => {
      let lats = [], lons = [], eastings = [], northings = [], zones = [];
      coordsList.forEach(c => {
        const [lng, lat] = c;
        const utm = latLngToUTM(lat, lng);
        lats.push(lat.toFixed(6));
        lons.push(lng.toFixed(6));
        eastings.push(utm.easting);
        northings.push(utm.northing);
        zones.push(utm.zone);
      });
      return {
        lats: lats.join(" | "),
        lons: lons.join(" | "),
        eastings: eastings.join(" | "),
        northings: northings.join(" | "),
        zone: zones[0]
      };
    };

    if (geomType === "Point") {
      count.point++;
      name = `نقطة ${count.point}`;
      type = "نقطة";
      const r = collect([geo.geometry.coordinates]);
      latCol = r.lats; lonCol = r.lons; eastingCol = r.eastings; northingCol = r.northings; zoneCol = r.zone;
      pointCount = 1;
    } else if (geomType === "LineString") {
      count.line++;
      name = `خط ${count.line}`;
      type = "خط";
      const r = collect(geo.geometry.coordinates);
      latCol = r.lats; lonCol = r.lons; eastingCol = r.eastings; northingCol = r.northings; zoneCol = r.zone;
      length = turf.length(geo, { units: "kilometers" }).toFixed(2);
      pointCount = geo.geometry.coordinates.length;
    } else if (geomType === "Polygon") {
      count.area++;
      name = `مساحة ${count.area}`;
      type = "مساحة";
      const r = collect(geo.geometry.coordinates[0]);
      latCol = r.lats; lonCol = r.lons; eastingCol = r.eastings; northingCol = r.northings; zoneCol = r.zone;
      area = (turf.area(geo) / 1000000).toFixed(2);
      pointCount = geo.geometry.coordinates[0].length;
    }

    csv += `${name},${type},"${latCol}","${lonCol}","${eastingCol}","${northingCol}",${zoneCol},${length},${area},${pointCount}\n`;
  });

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "my-drawings-UTM.csv";
  a.click();
  alert("تم التصدير جغرافي + UTM ✅");
});

document.getElementById("clearBtn").addEventListener("click", () => {
  Object.values(layers).forEach((l) => l.clearLayers());
  clusterGroup.clearLayers();
  renderServices();
  if (state.routing) {
    map.removeControl(state.routing);
    state.routing = null;
  }
  document.getElementById("nearestResult").innerHTML = "";
  document.getElementById("routeResult").innerHTML = "";
});

// ===== 13. موبايل =====
document
  .getElementById("menuBtn")
  .addEventListener("click", () =>
    document.getElementById("panel").classList.toggle("open"),
  );

// تشغيل
loadRealData();
