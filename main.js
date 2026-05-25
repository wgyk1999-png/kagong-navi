/* ══════════════════════════════════════════════════════════
   카공내비 — Main Application (main.js)
   ══════════════════════════════════════════════════════════ */

// Global state for dynamically fetched cafes
let CAFES = [];
let currentCenter = { lat: 37.55598, lng: 126.93666 }; // Sinchon Station Exit 3
let myLocation = { lat: 37.55598, lng: 126.93666 }; // Default my location
let map = null; // 글로벌 카카오맵 객체 확보
let sessionType = null; // 'user' | 'boss' | 'guest' (Memory-bound session)

// Realistic congestion and traffic simulator
function calculateRealisticCongestion(placeName, distanceStr) {
  const distance = parseInt(distanceStr || '0', 10);
  let score = 0;
  
  // [가중치 1] 주요 프랜차이즈 이름
  const franchises = ['스타벅스', '투썸', '이디야', '메가'];
  if (franchises.some(f => placeName.includes(f))) {
    score += 40;
  }

  // [가중치 2] 거리 가중치 (신촌역 등 중심점 기준)
  if (distance <= 300) {
    score += 30;
  } else if (distance > 500) {
    score -= 20;
  }

  // [가중치 3] 현재 시간 (피크타임)
  const hour = new Date().getHours();
  if ((hour >= 12 && hour < 15) || (hour >= 18 && hour < 20)) {
    score += 30;
  }

  // 기본 점수 랜덤 부여 (다양성 확보)
  score += Math.floor(Math.random() * 40);

  // 최종 상태 결정
  let congestion = 'green';
  if (score >= 70) congestion = 'red';
  else if (score >= 40) congestion = 'yellow';

  // 기존 인프라 기능 랜덤 주입 (1~3개)
  const allFeatures = ['콘센트', '단체석', '주차'];
  const numFeatures = Math.floor(Math.random() * 3) + 1;
  const shuffled = [...allFeatures].sort(() => 0.5 - Math.random());
  const features = shuffled.slice(0, numFeatures);

  const wifiQualities = ['high', 'secured', 'none'];
  const wifiQuality = wifiQualities[Math.floor(Math.random() * wifiQualities.length)];
  const totalSeats = Math.floor(Math.random() * 50) + 20;
  const availableOutlets = features.includes('콘센트') ? Math.floor(Math.random() * 20) + 5 : 0;
  const parkingEnabled = features.includes('주차');
  const parkingType = parkingEnabled ? (Math.random() > 0.5 ? ['surface'] : ['mechanical']) : [];
  const parkingCapacity = parkingEnabled ? Math.floor(Math.random() * 10) + 2 : 0;
  
  return { 
    congestion, 
    features, 
    wifiQuality,
    totalSeats,
    availableOutlets,
    parkingEnabled,
    parkingType,
    parkingCapacity
  };
}

// Mock Public API function returning real-time city data after 500ms
async function fetchCityData() {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        "seoulCityData": { "areaName": "신촌·이대역", "congestionLevel": "약간 붐빔", "populationDensity": 75 },
        "subwayData": { "station": "신촌역", "recentAlightmentLevel": "high" },
        "roadTraffic": { "roadName": "연세로", "speedKmH": 12 }
      });
    }, 500);
  });
}

const congestionCache = {};
const offDayCache = {}; // Deterministic off-day assignment

// Deterministic hash for off-day assignment (stable across reloads)
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

function isOffDay(placeName) {
  if (offDayCache[placeName] !== undefined) return offDayCache[placeName];
  const hash = hashCode(placeName);
  // 12% of cafes get off-day (randomized but deterministic)
  const result = (hash % 100) < 12;
  offDayCache[placeName] = result;
  return result;
}

function isOutsideOperatingHours() {
  const hour = new Date().getHours();
  return hour < 8 || hour >= 22;
}

// Advanced Congestion Engine that incorporates city data and spatial heuristics
async function calculateCongestion(placeName, distanceStr, cityData, lat, lng, address) {
  const cacheKey = placeName;
  const now = Date.now();

  if (congestionCache[cacheKey]) {
    const cached = congestionCache[cacheKey];
    if (now - cached.timestamp < 5 * 60 * 1000) {
      return {
        congestion: cached.status,
        score: cached.score,
        isOffDay: cached.isOffDay,
        isClosed: cached.isClosed,
        features: cached.features,
        wifiQuality: cached.wifiQuality,
        totalSeats: cached.totalSeats,
        availableOutlets: cached.availableOutlets,
        parkingEnabled: cached.parkingEnabled,
        parkingType: cached.parkingType,
        parkingCapacity: cached.parkingCapacity
      };
    }
  }

  const distance = parseInt(distanceStr || '0', 10);
  let score = 0;
  
  // [가중치 1] 주요 프랜차이즈 이름
  const franchises = ['스타벅스', '투썸', '이디야', '메가', '할리스'];
  const isFranchise = franchises.some(f => placeName.includes(f));
  if (isFranchise) {
    score += 40;
  }

  // [가중치 2] 거리 가중치 (신촌역 등 중심점 기준)
  if (distance <= 300) {
    score += 30;
  } else if (distance > 500) {
    score -= 20;
  }

  // [가중치 3] 현재 시간 (피크타임)
  const hour = new Date().getHours();
  if ((hour >= 12 && hour < 15) || (hour >= 18 && hour < 20)) {
    score += 30;
  }

  // [가중치 4] 서울시 실시간 상권 데이터 연계
  const sinchonLat = 37.55598;
  const sinchonLng = 126.93666;
  const distToSinchon = Math.sqrt(Math.pow(lat - sinchonLat, 2) + Math.pow(lng - sinchonLng, 2)) * 111000;
  const isWithin300m = distToSinchon <= 300;

  if (cityData) {
    const seoulData = cityData.seoulCityData;
    const subway = cityData.subwayData;
    const traffic = cityData.roadTraffic;

    if (isWithin300m) {
      if (seoulData.populationDensity >= 70 && subway.recentAlightmentLevel === 'high') {
        score += 50;
      }
    }
    
    if (traffic.speedKmH < 15) {
      score += 15;
    }
  }

  // [가중치 5] Alleyway Cooling: address NOT containing '연세로' or '대로' gets a heavy score drop of -35
  const isMainStreet = address && (address.includes('연세로') || address.includes('대로'));
  if (!isMainStreet) {
    score -= 35;
  }

  // [가중치 6] Capacity Defense: franchises get doubled ceiling
  const congestionCeiling = isFranchise ? 150 : 75;

  // 기본 점수 랜덤 부여 (다양성 확보)
  score += Math.floor(Math.random() * 40);

  // 최종 상태 결정 (franchise uses doubled ceiling)
  let congestion = 'green';
  if (isFranchise) {
    if (score >= 120) congestion = 'red';
    else if (score >= 60) congestion = 'yellow';
  } else {
    if (score >= 75) congestion = 'red';
    else if (score >= 45) congestion = 'yellow';
  }

  // Rule A & B: within 300m or franchise bias toward busy
  if (isWithin300m || isFranchise) {
    if (congestion === 'green') {
      congestion = 'yellow';
      score = 55;
    }
  }

  // Rule A & B exceptions:
  let forcedGreen = false;
  if (isWithin300m) {
    if (Math.random() < 0.28) {
      congestion = 'green';
      score = 30;
      forcedGreen = true;
    }
  }
  if (!forcedGreen && isFranchise) {
    if (Math.random() < 0.15) {
      congestion = 'green';
      score = 30;
      forcedGreen = true;
    }
  }

  // Off-day & operating hours check
  const cafeIsOffDay = isOffDay(placeName);
  const isClosed = isOutsideOperatingHours();

  // 기존 인프라 기능 랜덤 주입 (1~3개)
  const allFeatures = ['콘센트', '단체석', '주차'];
  const numFeatures = Math.floor(Math.random() * 3) + 1;
  const shuffled = [...allFeatures].sort(() => 0.5 - Math.random());
  const features = shuffled.slice(0, numFeatures);

  const wifiQualities = ['high', 'secured', 'none'];
  const wifiQuality = wifiQualities[Math.floor(Math.random() * wifiQualities.length)];
  const totalSeats = Math.floor(Math.random() * 50) + 20;
  const availableOutlets = features.includes('콘센트') ? Math.floor(Math.random() * 20) + 5 : 0;
  const parkingEnabled = features.includes('주차');
  const parkingType = parkingEnabled ? (Math.random() > 0.5 ? ['surface'] : ['mechanical']) : [];
  const parkingCapacity = parkingEnabled ? Math.floor(Math.random() * 10) + 2 : 0;

  const result = {
    status: congestion,
    score,
    isOffDay: cafeIsOffDay,
    isClosed,
    timestamp: now,
    features,
    wifiQuality,
    totalSeats,
    availableOutlets,
    parkingEnabled,
    parkingType,
    parkingCapacity
  };
  congestionCache[cacheKey] = result;

  return { 
    congestion, 
    features, 
    wifiQuality,
    totalSeats,
    availableOutlets,
    parkingEnabled,
    parkingType,
    parkingCapacity,
    score,
    isOffDay: cafeIsOffDay,
    isClosed
  };
}

// Global wrapper for dynamic bounds search
function searchPlacesInBounds() {
  if (KakaoMapManager && typeof KakaoMapManager.searchPlacesInBounds === 'function') {
    KakaoMapManager.searchPlacesInBounds();
  }
}

// ─── 1. KAKAO MAP MANAGER ────────────────────────────────
const KakaoMapManager = {
  map: null,
  placesService: null,
  overlays: [],
  myLocationOverlay: null,
  initialized: false,

  init() {
    if (this.initialized) return;

    if (typeof kakao === 'undefined' || !kakao.maps) {
      console.warn('⚠️ Kakao Maps SDK not loaded.');
      this._renderFallbackMap();
      return;
    }

    kakao.maps.load(() => {
      const container = document.getElementById('kakao-map');
      const options = {
        center: new kakao.maps.LatLng(currentCenter.lat, currentCenter.lng),
        level: 4,
      };

      this.map = new kakao.maps.Map(container, options);
      map = this.map; // 전역 map 객체에 할당
      this.placesService = new kakao.maps.services.Places(this.map);
      this.initialized = true;

      // Close detail modal when clicking empty space on Kakao Map (SDK listener)
      kakao.maps.event.addListener(this.map, 'click', () => {
        if (CafeDetailModal.modal && CafeDetailModal.modal.classList.contains('visible')) {
          CafeDetailModal.hide();
        }
      });

      // Create My Location overlay (Blue dot) but do not attach to map yet
      const myLocContent = document.createElement('div');
      myLocContent.className = 'my-location-wrapper';
      myLocContent.innerHTML = '<div class="my-location-pulse"></div><div class="my-location-marker"></div>';
      this.myLocationOverlay = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(myLocation.lat, myLocation.lng),
        content: myLocContent,
        zIndex: 5
      });

      // Search cafes initially
      this.searchCafes();

      // Re-search when map is dragged (idle)
      kakao.maps.event.addListener(this.map, 'idle', searchPlacesInBounds);

      // My Location Button
      const btnMyLocation = document.getElementById('btn-my-location');
      if (btnMyLocation) {
        btnMyLocation.addEventListener('click', () => this.moveToMyLocation());
      }
    });
  },

  moveToMyLocation() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          myLocation = { lat, lng };
          currentCenter = { lat, lng };
          
          const locPosition = new kakao.maps.LatLng(lat, lng);
          if (this.myLocationOverlay) {
            this.myLocationOverlay.setPosition(locPosition);
            this.myLocationOverlay.setMap(this.map); // 클릭했을 때만 맵에 노출
          }
          this.map.panTo(locPosition);
          this.searchCafes(); // 새 위치 기준으로 카페 검색 갱신
        },
        (error) => {
          console.error("Geolocation error: ", error);
          alert("현재 위치를 가져올 수 없습니다. 브라우저 위치 권한을 확인해주세요.");
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 5000
        }
      );
    } else {
      alert("이 브라우저에서는 현재 위치 기능을 지원하지 않습니다.");
    }
  },

  searchCafes() {
    this.searchPlacesInBounds();
  },

  searchPlacesInBounds() {
    if (!this.placesService || !this.map) return;

    const bounds = this.map.getBounds();
    const center = this.map.getCenter();
    currentCenter = { lat: center.getLat(), lng: center.getLng() };

    // Show skeleton loading
    this._showSkeletons();

    const startTime = Date.now();
    this.placesService.categorySearch('CE7', async (data, status) => {
      if (status === kakao.maps.services.Status.OK) {
        const cityData = await fetchCityData();
        CAFES = await Promise.all(data.map(async (place) => {
          const lat = parseFloat(place.y);
          const lng = parseFloat(place.x);
          const address = place.road_address_name || place.address_name || '';
          const stats = await calculateCongestion(place.place_name, place.distance, cityData, lat, lng, address);
          return {
            id: place.id,
            name: place.place_name,
            lat,
            lng,
            congestion: stats.congestion,
            features: stats.features,
            wifiQuality: stats.wifiQuality,
            totalSeats: stats.totalSeats,
            availableOutlets: stats.availableOutlets,
            parkingEnabled: stats.parkingEnabled,
            parkingType: stats.parkingType,
            parkingCapacity: stats.parkingCapacity,
            score: stats.score,
            isOffDay: stats.isOffDay,
            isClosed: stats.isClosed
          };
        }));
      } else {
        CAFES = [];
      }
      
      // Keep skeletons blinking for at least 500ms before rendering real markers
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 500 - elapsed);
      setTimeout(() => {
        this._hideSkeletons();
        this.filterMarkers(Array.from(FilterModule.activeFilters));
      }, remaining);
    }, { bounds });
  },

  _getPriorityScore(cafe) {
    if (cafe.congestion === 'green') {
      return 3;
    }
    const franchises = ['스타벅스', '투썸', '이디야', '메가', '할리스'];
    const isFranchise = franchises.some(f => cafe.name.includes(f));
    if (isFranchise && (cafe.congestion === 'yellow' || cafe.congestion === 'red')) {
      return 2;
    }
    return 1;
  },

  _getDistanceInMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  },

  _skeletonOverlays: [],

  _showSkeletons() {
    if (!this.map) return;
    this._hideSkeletons();
    const center = this.map.getCenter();
    const offsets = [
      { dlat: 0.001, dlng: -0.001 },
      { dlat: -0.0005, dlng: 0.0012 },
      { dlat: 0.0008, dlng: 0.0005 },
      { dlat: -0.001, dlng: -0.0008 }
    ];
    offsets.forEach(off => {
      const pos = new kakao.maps.LatLng(center.getLat() + off.dlat, center.getLng() + off.dlng);
      const el = document.createElement('div');
      el.className = 'skeleton-marker';
      el.innerHTML = '<div class="skeleton-bubble"></div><div class="skeleton-dot"></div>';
      const overlay = new kakao.maps.CustomOverlay({ position: pos, content: el, yAnchor: 1.3 });
      overlay.setMap(this.map);
      this._skeletonOverlays.push(overlay);
    });
  },

  _hideSkeletons() {
    this._skeletonOverlays.forEach(o => o.setMap(null));
    this._skeletonOverlays = [];
  },

  _declutterCafes(cafes) {
    if (!this.map || cafes.length === 0) return cafes;

    let proj = null;
    try {
      proj = this.map.getProjection();
    } catch (e) {
      console.warn("Failed to get map projection:", e);
    }
    if (!proj) return cafes;

    // Get screen points for all cafes
    const cafesWithPoints = cafes.map(cafe => {
      const latlng = new kakao.maps.LatLng(cafe.lat, cafe.lng);
      const pt = proj.containerPointFromCoords(latlng);
      return { cafe, pt };
    });

    // Sort by priority score descending (high priority surviving first)
    cafesWithPoints.sort((a, b) => {
      const pA = this._getPriorityScore(a.cafe);
      const pB = this._getPriorityScore(b.cafe);
      if (pA !== pB) return pB - pA;
      return (a.cafe.id || a.cafe.name).localeCompare(b.cafe.id || b.cafe.name);
    });

    const accepted = [];
    const threshold = 18; // 18px overlap radius for collision check

    for (let i = 0; i < cafesWithPoints.length; i++) {
      const candidate = cafesWithPoints[i];
      
      // Calculate how many accepted cafes exist inside a 50m radius of the candidate
      let countWithin50m = 0;
      for (let j = 0; j < accepted.length; j++) {
        const dist = this._getDistanceInMeters(
          candidate.cafe.lat, candidate.cafe.lng,
          accepted[j].cafe.lat, accepted[j].cafe.lng
        );
        if (dist <= 50) {
          countWithin50m++;
        }
      }

      // Minimum Survival Quota: If fewer than 4 cafes are in this 50m sector, accept it regardless of overlap
      if (countWithin50m < 4) {
        accepted.push(candidate);
        continue;
      }

      // Otherwise, check physical screen pixel collision with already accepted markers
      let overlaps = false;
      for (let j = 0; j < accepted.length; j++) {
        const dx = candidate.pt.x - accepted[j].pt.x;
        const dy = candidate.pt.y - accepted[j].pt.y;
        const screenDist = Math.sqrt(dx * dx + dy * dy);
        if (screenDist < threshold) {
          overlaps = true;
          break;
        }
      }

      if (!overlaps) {
        accepted.push(candidate);
      }
    }

    return accepted.map(c => c.cafe);
  },

  _renderMarkers(cafesToRender) {
    const newOverlays = [];

    // 1. Remove overlays not in new list or status changed
    this.overlays.forEach(o => {
      const cafeId = o.cafe.id || o.cafe.name;
      const matchingNewCafe = cafesToRender.find(c => (c.id || c.name) === cafeId);
      
      if (!matchingNewCafe || o.cafe.congestion !== matchingNewCafe.congestion || o.cafe.isOffDay !== matchingNewCafe.isOffDay) {
        o.overlay.setMap(null);
      } else {
        newOverlays.push(o);
      }
    });

    // 2. Add new overlays
    cafesToRender.forEach((cafe, index) => {
      const cafeId = cafe.id || cafe.name;
      const isAlreadyRendered = newOverlays.some(o => (o.cafe.id || o.cafe.name) === cafeId);

      if (!isAlreadyRendered) {
        const position = new kakao.maps.LatLng(cafe.lat, cafe.lng);
        const content = document.createElement('div');
        content.className = 'map-marker';
        
        // Gray tombstone for off-day or closed cafes
        const markerClass = (cafe.isOffDay || cafe.isClosed) ? 'closed' : cafe.congestion;
        const displayName = cafe.isOffDay ? `${cafe.name} (휴무)` : cafe.isClosed ? `${cafe.name} (영업종료)` : cafe.name;
        
        content.innerHTML = `
          <div class="marker-bubble ${markerClass}" style="animation-delay: ${(index % 10) * 0.06}s">
            ${displayName}
          </div>
          <div class="marker-pulse ${markerClass}"></div>
        `;

        const overlay = new kakao.maps.CustomOverlay({
          position,
          content,
          yAnchor: 1.3,
          clickable: true
        });

        // Use simple onclick since clickable: true is set on the Kakao map CustomOverlay
        content.onclick = function(e) {
          e.stopPropagation();
          CafeDetailModal.show(cafe);
        };

        overlay.setMap(this.map);
        newOverlays.push({ overlay, cafe, element: content });
      }
    });

    this.overlays = newOverlays;
  },

  filterMarkers(activeFilters) {
    let visibleCafes = CAFES;

    if (activeFilters.length > 0) {
      visibleCafes = CAFES.filter((cafe) =>
        activeFilters.every((f) => {
          if (f === '와이파이') {
            return cafe.wifiQuality && cafe.wifiQuality !== 'none';
          }
          return cafe.features.includes(f);
        })
      );
    }

    const declutteredCafes = this._declutterCafes(visibleCafes);
    this._renderMarkers(declutteredCafes);
    BottomSheet.updateStats(visibleCafes);
  },

  _renderFallbackMap() {
    const container = document.getElementById('kakao-map');
    container.innerHTML = `
      <div style="width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; background: linear-gradient(135deg, #e8e4da 0%, #d4cfc3 100%); color: #757575; text-align: center; padding: 24px; font-size: 14px; gap: 12px;">
        <span class="material-icons-round" style="font-size: 48px; color: #bdbdbd;">error_outline</span>
        <p style="font-weight: 600; color: #d32f2f; font-size: 16px;">카카오 맵 API 로드 실패</p>
        <div style="font-size: 13px; line-height: 1.6; color: #424242; text-align: left; background: rgba(255,255,255,0.7); padding: 16px; border-radius: 8px;">
          <strong>원인 확인:</strong><br>
          1. 카카오 개발자 콘솔의 <b>[내 애플리케이션 > 앱 설정 > 플랫폼 > Web]</b>에 <code style="background: #eee; padding: 2px 4px;">http://localhost:3000</code> 도메인이 등록되어 있는지 꼭 확인하세요.<br>
          2. API 키가 잘못 복사되었거나 네트워크 문제가 있을 수 있습니다.
        </div>
      </div>
    `;
    this.initialized = true;
  },
};


// ─── 2. FILTER CHIPS MODULE ──────────────────────────────
const FilterModule = {
  activeFilters: new Set(),

  init() {
    const chipsContainer = document.getElementById('filter-chips');
    if (!chipsContainer) return;

    chipsContainer.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;

      const filter = chip.dataset.filter;

      if (this.activeFilters.has(filter)) {
        this.activeFilters.delete(filter);
        chip.classList.remove('active');
      } else {
        this.activeFilters.add(filter);
        chip.classList.add('active');
      }

      KakaoMapManager.filterMarkers(Array.from(this.activeFilters));
    });
  },
};


// ─── 3. BOTTOM SHEET MODULE ──────────────────────────────
const BottomSheet = {
  sheet: null,
  overlay: null,
  isExpanded: false,
  startY: 0,
  currentY: 0,

  init() {
    this.sheet = document.getElementById('bottom-sheet');
    this.overlay = document.getElementById('sheet-overlay');

    if (!this.sheet || !this.overlay) return;

    this.sheet.classList.add('collapsed');

    const handle = this.sheet.querySelector('.sheet-handle');
    handle.addEventListener('click', () => this.toggle());

    const collapsed = document.getElementById('sheet-collapsed');
    collapsed.addEventListener('click', () => {
      if (!this.isExpanded) this.expand();
    });

    this.overlay.addEventListener('click', () => this.collapse());

    handle.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: true });
    handle.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
    handle.addEventListener('touchend', () => this._onTouchEnd());
  },

  updateStats(cafes) {
    const greenCount = cafes.filter((c) => c.congestion === 'green').length;
    const yellowCount = cafes.filter((c) => c.congestion === 'yellow').length;
    const redCount = cafes.filter((c) => c.congestion === 'red').length;

    const collapsedEl = document.getElementById('sheet-collapsed');
    collapsedEl.innerHTML = `
      <div class="summary-text">
        <span class="material-icons-round" style="color: var(--green); font-size: 20px;">check_circle</span>
        현재 지도 내 여유 카페: <span class="count-highlight">${greenCount}곳 발견</span>
      </div>
    `;

    // Calculate nearest green cafe for Plan B
    const myLat = currentCenter.lat;
    const myLng = currentCenter.lng;
    const greenCafes = cafes.filter((c) => c.congestion === 'green');
    let greenCafe = null;

    if (greenCafes.length > 0) {
      greenCafe = greenCafes.reduce((prev, curr) => {
        const prevDist = Math.pow(prev.lat - myLat, 2) + Math.pow(prev.lng - myLng, 2);
        const currDist = Math.pow(curr.lat - myLat, 2) + Math.pow(curr.lng - myLng, 2);
        return currDist < prevDist ? curr : prev;
      });
      const dist = Math.sqrt(Math.pow(greenCafe.lat - myLat, 2) + Math.pow(greenCafe.lng - myLng, 2));
      greenCafe.distanceStr = Math.round(dist * 111000) + 'm';
    }

    const expandedEl = document.getElementById('sheet-expanded');
    expandedEl.innerHTML = `
      <div class="stat-breakdown stagger-children">
        <div class="stat-item green">
          <span class="stat-dot"></span>
          🟢 ${greenCount}곳
        </div>
        <div class="stat-item yellow">
          <span class="stat-dot"></span>
          🟡 ${yellowCount}곳
        </div>
        <div class="stat-item red">
          <span class="stat-dot"></span>
          🔴 ${redCount}곳
        </div>
      </div>

      ${greenCafe ? `
      <div class="plan-b-section">
        <div class="plan-b-title">
          🎯 내 맞춤 추천 (지금 쾌적한 카페)
        </div>
        <div class="plan-b-card" style="cursor: pointer;">
          <div class="plan-b-cafe-icon">☕</div>
          <div class="plan-b-info">
            <div class="cafe-name" style="color: #333333; font-weight: bold;">${greenCafe.name}</div>
            <div class="cafe-detail">
              <span class="plan-b-badge">🟢 여유</span>
              <span style="font-size:12px; color:#555555; font-weight:500;">거리 약 ${greenCafe.distanceStr}</span>
              <span>${greenCafe.features.join(' · ')}</span>
            </div>
          </div>
          <div class="plan-b-go">
            <span class="material-icons-round" style="font-size: 24px; color: #981b15;">chevron_right</span>
          </div>
        </div>
      </div>
      ` : `
      <div class="plan-b-section">
        <div class="plan-b-title">🎯 내 맞춤 추천</div>
        <p style="color: var(--gray-500); font-size: 13px;">현재 조건에 맞는 여유 카페가 없습니다.</p>
      </div>
      `}
    `;

    // Wire up matched card click to Cafe Detail Modal
    if (greenCafe) {
      const planBCard = expandedEl.querySelector('.plan-b-card');
      if (planBCard) {
        planBCard.addEventListener('click', () => {
          CafeDetailModal.show(greenCafe);
        });
      }
    }
  },

  toggle() {
    this.isExpanded ? this.collapse() : this.expand();
  },

  expand() {
    this.isExpanded = true;
    this.sheet.classList.remove('collapsed');
    this.sheet.classList.add('expanded');
    this.overlay.classList.add('visible');
  },

  collapse() {
    this.isExpanded = false;
    this.sheet.classList.remove('expanded');
    this.sheet.classList.add('collapsed');
    this.overlay.classList.remove('visible');
  },

  _onTouchStart(e) {
    this.startY = e.touches[0].clientY;
  },

  _onTouchMove(e) {
    this.currentY = e.touches[0].clientY;
    const diff = this.startY - this.currentY;

    if (diff > 40 && !this.isExpanded) {
      this.expand();
      e.preventDefault();
    }
    if (diff < -40 && this.isExpanded) {
      this.collapse();
      e.preventDefault();
    }
  },

  _onTouchEnd() {
    this.startY = 0;
    this.currentY = 0;
  },
};


// ─── 4. BOTTOM NAVIGATION MODULE ─────────────────────────
const BottomNav = {
  init() {
    const nav = document.getElementById('bottom-nav');
    if (!nav) return;
    nav.addEventListener('click', (e) => {
      const item = e.target.closest('.nav-item');
      if (!item) return;
      this.switchTab(item.dataset.tab);
    });
  },
  switchTab(tabId) {
    const nav = document.getElementById('bottom-nav');
    nav.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
    const activeBtn = nav.querySelector(`[data-tab="${tabId}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    // Instantly hide map view to prevent flicker and bleed-through
    const homeView = document.getElementById('view-home');
    if (homeView) {
      if (tabId === 'home') {
        homeView.classList.remove('tab-inactive');
        if (KakaoMapManager.map) {
          KakaoMapManager.map.relayout();
        }
      } else {
        homeView.classList.add('tab-inactive');
      }
    }

    // Toggle display of other views
    const nonHomeTabs = ['search', 'favorites', 'mypage'];
    nonHomeTabs.forEach(id => {
      const v = document.getElementById(`view-${id}`);
      if (v) {
        v.style.display = (id === tabId) ? 'block' : 'none';
      }
    });

    const viewBoss = document.getElementById('view-boss');
    if (viewBoss && tabId !== 'mypage') {
      viewBoss.style.display = 'none';
    }

    if (tabId === 'favorites') FavoritesModule.render();
  }
};

// ─── 5. CAFE DETAIL MODAL MODULE ─────────────────────────
function generateMockReviews(features) {
  const allReviews = [];
  if (features.includes('콘센트')) allReviews.push({ name: '카공러', text: '콘센트 자리가 많아서 노트북 작업하기 너무 좋았어요!' });
  if (features.includes('단체석') || features.includes('넓은 책상')) allReviews.push({ name: '모임장', text: '여럿이서 앉을 수 있는 넓은 테이블이 있어서 편했어요.' });
  if (features.includes('감성 인테리어')) allReviews.push({ name: '인스타그래머', text: '사진 찍기 좋은 예쁜 인테리어! 분위기 완전 좋아요.' });
  if (features.includes('조용한 분위기') || features.includes('조용함')) allReviews.push({ name: '집중러', text: '소음이 적어서 백색소음 느끼며 공부하기 좋네요.' });
  if (features.includes('디저트 맛집')) allReviews.push({ name: '빵순이', text: '여기 디저트 진짜 맛있어요. 재방문 의사 100%!' });
  
  if (allReviews.length === 0) {
    allReviews.push({ name: '단골손님', text: '항상 만족스럽게 이용하는 곳입니다.' });
    allReviews.push({ name: '방문객', text: '직원분들이 친절하고 매장이 청결해요.' });
  } else if (allReviews.length < 2) {
    allReviews.push({ name: '방문객', text: '음료도 맛있고 매장이 깔끔해서 좋았어요.' });
  }
  return allReviews.slice(0, 2);
}

const CafeDetailModal = {
  overlay: null,
  modal: null,
  content: null,

  init() {
    this.overlay = document.getElementById('cafe-detail-overlay');
    this.modal = document.getElementById('cafe-detail-modal');
    this.content = document.getElementById('cafe-detail-content');

    if (!this.overlay || !this.modal) return;

    document.getElementById('btn-close-modal').addEventListener('click', () => this.hide());
    this.overlay.addEventListener('click', () => this.hide());
  },

  show(cafe) {
    // Reliably hook into the congestionCache first
    const cached = congestionCache[cafe.name];
    if (cached) {
      cafe.congestion = cached.status;
      cafe.isOffDay = cached.isOffDay;
      cafe.isClosed = cached.isClosed;
      cafe.features = cached.features || cafe.features;
      cafe.wifiQuality = cached.wifiQuality || cafe.wifiQuality;
      cafe.totalSeats = cached.totalSeats || cafe.totalSeats;
      cafe.availableOutlets = cached.availableOutlets || cafe.availableOutlets;
      cafe.parkingEnabled = cached.parkingEnabled || cafe.parkingEnabled;
      cafe.parkingType = cached.parkingType || cafe.parkingType;
      cafe.parkingCapacity = cached.parkingCapacity || cafe.parkingCapacity;
    }

    const directionsUrl = `https://map.kakao.com/link/to/${encodeURIComponent(cafe.name)},${cafe.lat},${cafe.lng}`;
    
    // Determine badge display (pure atomic badge)
    let badgeClass = '', badgeEmoji = '', badgeLabel = '';
    if (cafe.isOffDay) {
      badgeClass = 'closed-badge'; badgeEmoji = '⬜'; badgeLabel = '오늘 휴무';
    } else if (cafe.isClosed) {
      badgeClass = 'closed-badge'; badgeEmoji = '⬜'; badgeLabel = '영업 종료';
    } else if (cafe.congestion === 'green') {
      badgeClass = 'green'; badgeEmoji = '🟢'; badgeLabel = '여유';
    } else if (cafe.congestion === 'yellow') {
      badgeClass = 'yellow'; badgeEmoji = '🟡'; badgeLabel = '보통';
    } else {
      badgeClass = 'red'; badgeEmoji = '🔴'; badgeLabel = '혼잡';
    }
    
    const isFav = FavoritesModule.isFavorite(cafe.id || cafe.name);

    this.content.innerHTML = `
      <div style="margin-bottom: 12px; display: flex; align-items: center; gap: 12px;">
        <span class="congestion-badge ${badgeClass}">${badgeEmoji} ${badgeLabel}</span>
      </div>
      <h2 style="font-size: 22px; font-weight: 700; color: #333333; margin-bottom: 8px;">${cafe.name}</h2>
      <button class="modal-star-btn ${isFav ? 'active' : ''}" id="modal-fav-btn">
        <span class="material-icons-round">${isFav ? 'star' : 'star_border'}</span>
        ${isFav ? '즐겨찾기 해제' : '즐겨찾기 추가'}
      </button>
      <div style="font-size: 14px; color: #333333; margin-bottom: 16px; display: flex; gap: 8px; align-items: center;">
        <span class="material-icons-round" style="font-size: 16px; color: #981b15;">info</span>
        ${cafe.features.length > 0 ? cafe.features.join(' · ') : '제공되는 부가정보 없음'}
      </div>
      
      <!-- Review Accordion -->
      <button class="btn-view-review" onclick="document.getElementById('modal-review-content').classList.toggle('open')">
        📝 리뷰 보기 <span class="material-icons-round" style="font-size:16px;">expand_more</span>
      </button>
      <div class="review-accordion-content" id="modal-review-content">
        ${generateMockReviews(cafe.features).map(r => `
          <div class="review-item">
            <div class="reviewer">${r.name}</div>
            <div>"${r.text}"</div>
          </div>
        `).join('')}
        <!-- Hard 1:1 square crop Instagram-style imagery -->
        <div class="review-image-grid">
          <img src="./review_cafe_1.png" alt="Review Cafe 1">
          <img src="./review_cafe_2.png" alt="Review Cafe 2">
          <img src="./review_cafe_3.png" alt="Review Cafe 3">
        </div>
      </div>

      <button id="btn-modal-directions" style="width: 100%; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; background: #FEE500; color: #333333; padding: 14px 20px; border-radius: 12px; font-weight: bold; font-size: 16px; transition: 0.2s;">
        <span class="material-icons-round" style="margin-right: 8px; font-size: 20px; color: #333333;">directions</span>
        카카오맵으로 길찾기
      </button>
    `;
    // Fav toggle handler
    document.getElementById('modal-fav-btn').addEventListener('click', () => {
      FavoritesModule.toggle(cafe);
      this.show(cafe); // re-render modal
    });

    const btnDirections = document.getElementById('btn-modal-directions');
    if (btnDirections) {
      const newBtn = btnDirections.cloneNode(true);
      btnDirections.parentNode.replaceChild(newBtn, btnDirections);
      newBtn.addEventListener('click', () => {
        this.hide();
        NavigationSimulator.start(cafe, directionsUrl);
      });
    }
    
    this.overlay.classList.add('visible');
    this.modal.classList.add('visible');
  },

  hide() {
    this.overlay.classList.remove('visible');
    this.modal.classList.remove('visible');
  }
};


// ─── 6. FAVORITES MODULE (localStorage) ───────────────────
const FavoritesModule = {
  STORAGE_KEY: 'cagong_favorites',
  _get() {
    try { return JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || []; }
    catch { return []; }
  },
  _save(arr) { localStorage.setItem(this.STORAGE_KEY, JSON.stringify(arr)); },
  isFavorite(id) { return this._get().some(c => (c.id || c.name) === id); },
  toggle(cafe) {
    let favs = this._get();
    const key = cafe.id || cafe.name;
    if (favs.some(c => (c.id || c.name) === key)) {
      favs = favs.filter(c => (c.id || c.name) !== key);
    } else {
      const tags = cafe.features ? cafe.features.map(f => `#${f}`) : [];
      favs.push({ id: cafe.id, name: cafe.name, lat: cafe.lat, lng: cafe.lng, tags, congestion: cafe.congestion, features: cafe.features, descriptionText: cafe.descriptionText });
    }
    this._save(favs);
  },
  remove(id) {
    this._save(this._get().filter(c => (c.id || c.name) !== id));
  },
  render() {
    const container = document.getElementById('favorites-list');
    if (!container) return;
    const favs = this._get();
    if (favs.length === 0) {
      container.innerHTML = `<div class="fav-empty"><span class="material-icons-round">bookmark_border</span><p>아직 즐겨찾기한 카페가 없습니다.</p></div>`;
      return;
    }
    container.innerHTML = favs.map(cafe => `
      <div class="fav-card" data-fav-id="${cafe.id || cafe.name}">
        <div class="fav-info" style="cursor:pointer;">
          <h3 class="cafe-name">${cafe.name}</h3>
          <div class="cafe-tags">${(cafe.tags || []).map(t => `<span>${t}</span>`).join('')}</div>
        </div>
        <button class="btn-star active" data-remove-id="${cafe.id || cafe.name}"><span class="material-icons-round">star</span></button>
      </div>
    `).join('');
    container.querySelectorAll('.fav-info').forEach(info => {
      info.addEventListener('click', () => {
        const id = info.closest('.fav-card').dataset.favId;
        const cafe = favs.find(c => (c.id || c.name) == id);
        if (cafe) this._navigateToCafe(cafe);
      });
    });
    container.querySelectorAll('.btn-star').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.fav-card');
        card.classList.add('removing');
        setTimeout(() => { this.remove(btn.dataset.removeId); this.render(); }, 300);
      });
    });
  },
  async _navigateToCafe(cafe) {
    if (!cafe.congestion) {
      const cityData = await fetchCityData();
      const s = await calculateCongestion(cafe.name, '0', cityData, cafe.lat, cafe.lng, '');
      Object.assign(cafe, s);
    }
    BottomNav.switchTab('home');
    setTimeout(() => {
      if (KakaoMapManager.map) {
        KakaoMapManager.map.panTo(new kakao.maps.LatLng(cafe.lat, cafe.lng));
        currentCenter = { lat: cafe.lat, lng: cafe.lng };
      }
      CafeDetailModal.show(cafe);
    }, 200);
  },
  init() {}
};

// ─── 7. SEARCH MODULE ─────────────────────────────────────
const MockDataGenerator = {
  getResults(category) {
    const baseLat = 37.5559, baseLng = 126.9369;
    let cafes = [];
    if (category === '공부하기 좋은') {
      cafes = [
        { name: '투썸플레이스 신촌점', lat: baseLat + 0.001, lng: baseLng, features: ['콘센트', '조용한 분위기'], congestion: 'green' },
        { name: '할리스 신촌연세로점', lat: baseLat, lng: baseLng + 0.001, features: ['콘센트', '넓은 책상'], congestion: 'green' }
      ];
    } else if (category === '작업하기 좋은') {
      cafes = [
        { name: '스타벅스 신촌명물거리점', lat: baseLat + 0.002, lng: baseLng + 0.002, features: ['콘센트', '단체석'], congestion: 'yellow' },
      ];
    } else if (category === '대화하기 좋은') {
      cafes = [
        { name: '카페 포엠', lat: baseLat - 0.001, lng: baseLng - 0.001, features: ['단체석', '디저트 맛집'], congestion: 'yellow' }
      ];
    } else if (category === '분위기 좋은') {
      cafes = [
        { name: '독수리다방', lat: baseLat + 0.003, lng: baseLng - 0.001, features: ['감성 인테리어', '루프탑'], congestion: 'green' }
      ];
    }
    return cafes.map((c, i) => ({ ...c, id: `mock_${category}_${i}`, distance: 200 + i * 50 }));
  }
};

const SearchModule = {
  init() {
    const input = document.getElementById('search-tab-input');
    if (!input) return;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) this.search(input.value.trim());
    });
    document.getElementById('recent-tags').addEventListener('click', (e) => {
      const tag = e.target.closest('.tag');
      if (!tag) return;
      input.value = tag.dataset.query || tag.textContent;
      this.search(input.value);
    });

    const chipsContainer = document.getElementById('search-category-chips');
    if (chipsContainer) {
      chipsContainer.addEventListener('click', (e) => {
        const chip = e.target.closest('.search-chip');
        if (!chip) return;
        
        chipsContainer.querySelectorAll('.search-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        
        const category = chip.dataset.category;
        this.renderMockResults(category);
      });
    }
  },
  renderMockResults(category) {
    const resultsSection = document.getElementById('search-results');
    const listEl = document.getElementById('search-results-list');
    const titleEl = document.getElementById('search-results-title');
    document.getElementById('recent-searches-section').style.display = 'none';
    resultsSection.style.display = 'block';

    const data = MockDataGenerator.getResults(category);
    titleEl.textContent = `'${category}' 모의 추천 결과 (${data.length}건)`;
    
    listEl.innerHTML = data.map((cafe, idx) => `
      <div class="search-result-card" data-index="${idx}" style="flex-direction:column; align-items:stretch; gap:12px;">
        <div style="display:flex; align-items:center; gap:16px;">
          <div class="result-icon">☕</div>
          <div class="result-info">
            <div class="name">${cafe.name}</div>
            <div class="address">신촌역 주변 ${cafe.distance}m</div>
          </div>
          <span class="material-icons-round result-arrow">chevron_right</span>
        </div>
        <div>
          <button class="btn-view-review" onclick="event.stopPropagation(); document.getElementById('search-review-${idx}').classList.toggle('open')">
            📝 리뷰 보기 <span class="material-icons-round" style="font-size:16px;">expand_more</span>
          </button>
          <div class="review-accordion-content" id="search-review-${idx}">
            ${generateMockReviews(cafe.features).map(r => `
              <div class="review-item">
                <div class="reviewer">${r.name}</div>
                <div>"${r.text}"</div>
              </div>
            `).join('')}
            <div class="review-image-grid">
              <img src="./review_cafe_1.png" alt="Review Cafe 1">
              <img src="./review_cafe_2.png" alt="Review Cafe 2">
              <img src="./review_cafe_3.png" alt="Review Cafe 3">
            </div>
          </div>
        </div>
      </div>
    `).join('');

    listEl.querySelectorAll('.search-result-card').forEach(card => {
      card.addEventListener('click', () => {
        const idx = card.dataset.index;
        const cafe = data[idx];
        BottomNav.switchTab('home');
        setTimeout(() => {
          if (KakaoMapManager.map) {
            KakaoMapManager.map.panTo(new kakao.maps.LatLng(cafe.lat, cafe.lng));
            currentCenter = { lat: cafe.lat, lng: cafe.lng };
          }
          CafeDetailModal.show(cafe);
        }, 200);
      });
    });
  },
  search(keyword) {
    const ps = new kakao.maps.services.Places();
    ps.keywordSearch(keyword, async (data, status) => {
      const resultsSection = document.getElementById('search-results');
      const listEl = document.getElementById('search-results-list');
      const titleEl = document.getElementById('search-results-title');
      document.getElementById('recent-searches-section').style.display = 'none';
      resultsSection.style.display = 'block';
      if (status === kakao.maps.services.Status.OK) {
        titleEl.textContent = `"${keyword}" 검색 결과 (${data.length}건)`;
        const cityData = await fetchCityData();
        const resultsWithStats = await Promise.all(data.map(async (p) => {
          const address = p.road_address_name || p.address_name || '';
          const stats = await calculateCongestion(p.place_name, '0', cityData, parseFloat(p.y), parseFloat(p.x), address);
          return { place: p, stats };
        }));

        listEl.innerHTML = resultsWithStats.map((item, idx) => {
          const p = item.place;
          const stats = item.stats;
          return `
          <div class="search-result-card" data-lat="${p.y}" data-lng="${p.x}" data-name="${p.place_name}" data-index="api_${idx}" style="flex-direction:column; align-items:stretch; gap:12px;">
            <div style="display:flex; align-items:center; gap:16px;">
              <div class="result-icon">☕</div>
              <div class="result-info">
                <div class="name">${p.place_name}</div>
                <div class="address">${p.road_address_name || p.address_name}</div>
              </div>
              <span class="material-icons-round result-arrow">chevron_right</span>
            </div>
            <div>
              <button class="btn-view-review" onclick="event.stopPropagation(); document.getElementById('api-review-${idx}').classList.toggle('open')">
                📝 리뷰 보기 <span class="material-icons-round" style="font-size:16px;">expand_more</span>
              </button>
              <div class="review-accordion-content" id="api-review-${idx}">
                ${generateMockReviews(stats.features).map(r => `
                  <div class="review-item">
                    <div class="reviewer">${r.name}</div>
                    <div>"${r.text}"</div>
                  </div>
                `).join('')}
                <div class="review-image-grid">
                  <img src="./review_cafe_1.png" alt="Review Cafe 1">
                  <img src="./review_cafe_2.png" alt="Review Cafe 2">
                  <img src="./review_cafe_3.png" alt="Review Cafe 3">
                </div>
              </div>
            </div>
          </div>
        `}).join('');

        listEl.querySelectorAll('.search-result-card').forEach((card, idx) => {
          card.addEventListener('click', () => {
            const item = resultsWithStats[idx];
            const p = item.place;
            const stats = item.stats;
            const lat = parseFloat(p.y);
            const lng = parseFloat(p.x);
            const cafe = { id: p.place_name, name: p.place_name, lat, lng, ...stats };
            BottomNav.switchTab('home');
            setTimeout(() => {
              if (KakaoMapManager.map) {
                KakaoMapManager.map.panTo(new kakao.maps.LatLng(lat, lng));
                currentCenter = { lat, lng };
              }
              CafeDetailModal.show(cafe);
            }, 200);
          });
        });
      } else {
        titleEl.textContent = `"${keyword}" 검색 결과`;
        listEl.innerHTML = '<p style="color:var(--gray-500);text-align:center;padding:40px 0;">검색 결과가 없습니다.</p>';
      }
    }, { category_group_code: 'CE7' });
  }
};

// ─── 8. MY PAGE MODULE ────────────────────────────────────
const MyPageModule = {
  init() {
    document.querySelectorAll('.accordion-trigger').forEach(trigger => {
      trigger.addEventListener('click', function() {
        this.classList.toggle('expanded');
        const t = document.getElementById(this.dataset.target);
        if (t) t.classList.toggle('open');
      });
    });
    const editBtn = document.getElementById('btn-edit-profile');
    if (editBtn) {
      editBtn.addEventListener('click', () => {
        const newName = prompt('새로운 이름을 입력하세요:', document.getElementById('profile-name').textContent);
        if (newName && newName.trim()) document.getElementById('profile-name').textContent = newName.trim();
      });
    }

    // sleek [로그아웃] button handler
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', () => {
        sessionType = null;
        
        // Show splash screen overlay
        const splash = document.getElementById('view-splash');
        if (splash) {
          splash.classList.remove('hidden');
          SplashModule.goToStep('role');
        }

        // Clean guest indicators and placeholders
        const placeholder = document.getElementById('guest-mypage-placeholder');
        if (placeholder) placeholder.remove();

        const viewMypage = document.getElementById('view-mypage');
        if (viewMypage) {
          const profileCard = viewMypage.querySelector('.profile-card');
          const menuList = viewMypage.querySelector('.menu-list');
          const bossBanner = viewMypage.querySelector('.boss-entry-banner');
          if (profileCard) profileCard.style.display = '';
          if (menuList) menuList.style.display = '';
          if (bossBanner) bossBanner.style.display = '';
        }

        // Wipe URL parameters
        history.replaceState({}, document.title, window.location.pathname);
      });
    }
  }
};

// ─── 8.2. NAVIGATION SIMULATOR MODULE (Real-Time Rerouting Plan B) ───
const NavigationSimulator = {
  activeCafe: null,
  timerId: null,

  start(cafe, directionsUrl) {
    this.activeCafe = cafe;
    this.clear();

    const willReroute = Math.random() < 0.2; // 20% probability for the reroute popup

    if (!willReroute && directionsUrl) {
      window.open(directionsUrl, '_blank');
      return; // Skip simulation and go straight to real nav
    }

    // Show indicator banner and set text
    const indicator = document.getElementById('nav-indicator');
    const indicatorText = document.getElementById('nav-indicator-text');
    if (indicator && indicatorText) {
      indicatorText.textContent = `📍 현위치에서 [${cafe.name}](으)로 안내 중...`;
      indicator.style.display = 'flex';
      
      const btnCancel = document.getElementById('btn-cancel-nav');
      if (btnCancel) {
        btnCancel.onclick = () => {
          this.clear();
          indicator.style.display = 'none';
        };
      }
      // Banner vanishes automatically after 10 seconds
      setTimeout(() => {
        if (indicator.style.display === 'flex') {
          indicator.style.display = 'none';
        }
      }, 10000);
    }

    // Start 3 second timer for the popup
    this.timerId = setTimeout(() => {
      this.triggerCongestionEvent();
    }, 3000);
  },

  clear() {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  },

  triggerCongestionEvent() {
    if (!this.activeCafe) return;

    // 1. Destination cafe's status turns red
    const cafeInList = CAFES.find(c => c.id === this.activeCafe.id || c.name === this.activeCafe.name);
    if (cafeInList) {
      cafeInList.congestion = 'red';
      cafeInList.descriptionText = '📊 서울시 상권 데이터: 현재 주변 상권 유동인구 집중으로 인해 혼잡도가 높습니다.';
      this.activeCafe = cafeInList;

      // Ensure cache is also updated so panning/zooming does not overwrite the simulated red status
      congestionCache[cafeInList.name] = {
        status: 'red',
        score: 90,
        descriptionText: '📊 서울시 상권 데이터: 현재 주변 상권 유동인구 집중으로 인해 혼잡도가 높습니다.',
        timestamp: Date.now(),
        features: cafeInList.features || [],
        wifiQuality: cafeInList.wifiQuality || 'high',
        totalSeats: cafeInList.totalSeats || 40,
        availableOutlets: cafeInList.availableOutlets || 10,
        parkingEnabled: cafeInList.parkingEnabled || false,
        parkingType: cafeInList.parkingType || [],
        parkingCapacity: cafeInList.parkingCapacity || 0
      };
    }

    // Refresh map markers
    KakaoMapManager.filterMarkers(Array.from(FilterModule.activeFilters));

    // 2. Find alternative closest green cafe matching current filters
    const activeFilters = Array.from(FilterModule.activeFilters);
    let altCafe = this.findAlternative(this.activeCafe, activeFilters);

    if (!altCafe) {
      altCafe = this.findAlternative(this.activeCafe, []);
    }

    if (altCafe) {
      // 3. Show rerouting modal
      const modalOverlay = document.getElementById('reroute-modal-overlay');
      const altCafeName = document.getElementById('reroute-alt-cafe-name');
      const modalBox = modalOverlay ? modalOverlay.querySelector('.reroute-modal') : null;
      
      if (modalOverlay && altCafeName) {
        altCafeName.textContent = altCafe.name;
        modalOverlay.style.display = 'flex';
        setTimeout(() => {
          if (modalBox) modalBox.classList.add('active');
        }, 50);

        // Bind buttons
        const btnYes = document.getElementById('btn-reroute-yes');
        const btnNo = document.getElementById('btn-reroute-no');

        btnYes.onclick = () => {
          // Hide modal
          if (modalBox) modalBox.classList.remove('active');
          setTimeout(() => {
            modalOverlay.style.display = 'none';
          }, 300);

          // Pan map to alternative
          if (KakaoMapManager.map) {
            KakaoMapManager.map.panTo(new kakao.maps.LatLng(altCafe.lat, altCafe.lng));
            currentCenter = { lat: altCafe.lat, lng: altCafe.lng };
          }

          // Show detail modal
          CafeDetailModal.show(altCafe);

          // Restart navigation simulation to the new cafe
          this.start(altCafe);
        };

        btnNo.onclick = () => {
          // Hide modal
          if (modalBox) modalBox.classList.remove('active');
          setTimeout(() => {
            modalOverlay.style.display = 'none';
          }, 300);

          // Just let the user proceed
          const indicatorText = document.getElementById('nav-indicator-text');
          if (indicatorText) {
            indicatorText.textContent = `📍 신촌역점에서 [${this.activeCafe.name}]으로 계속 이동 중 (혼잡도 상승)...`;
          }
        };
      }
    } else {
      console.warn("No alternative green cafe found.");
      const indicator = document.getElementById('nav-indicator');
      if (indicator) indicator.style.display = 'none';
      alert("⚠️ 목적지가 만석 상태가 되었습니다.");
    }
  },

  findAlternative(currentCafe, filters) {
    let candidates = CAFES.filter(c => c.name !== currentCafe.name && c.congestion === 'green');

    if (filters && filters.length > 0) {
      candidates = candidates.filter(c =>
        filters.every(f => {
          if (f === '와이파이') {
            return c.wifiQuality && c.wifiQuality !== 'none';
          }
          return c.features.includes(f);
        })
      );
    }

    if (candidates.length === 0) return null;

    // Find the closest one
    return candidates.reduce((prev, curr) => {
      const prevDist = Math.sqrt(Math.pow(prev.lat - myLocation.lat, 2) + Math.pow(prev.lng - myLocation.lng, 2));
      const currDist = Math.sqrt(Math.pow(curr.lat - myLocation.lat, 2) + Math.pow(curr.lng - myLocation.lng, 2));
      return prevDist < currDist ? prev : curr;
    });
  }
};

// ─── 8.5. BOSS CENTER MODULE ───────────────────────────────────
const BossCenterModule = {
  toastTimeout: null,
  
  getStore() {
    let store = CAFES.find(c => c.name.includes('스타벅스 신촌점') || c.name.includes('스타벅스'));
    if (!store) {
      store = {
        id: 'starbucks_shinchon',
        name: '스타벅스 신촌점',
        lat: 37.5559,
        lng: 126.9369,
        congestion: 'green',
        features: ['콘센트', '와이파이'],
        wifiQuality: 'high',
        totalSeats: 48,
        availableOutlets: 24,
        parkingEnabled: true,
        parkingType: ['surface'],
        parkingCapacity: 5
      };
      CAFES.push(store);
    }
    return store;
  },

  loadStoreDetails() {
    const store = this.getStore();
    
    const seatsInput = document.getElementById('boss-seats-count');
    const outletsInput = document.getElementById('boss-outlets-count');
    const wifiSelect = document.getElementById('boss-wifi-availability');
    const parkingToggle = document.getElementById('boss-parking-toggle');
    const parkingSubpanel = document.getElementById('boss-parking-subpanel');
    const parkingSurface = document.getElementById('parking-type-surface');
    const parkingMechanical = document.getElementById('parking-type-mechanical');
    const parkingCapacity = document.getElementById('boss-parking-capacity');

    if (seatsInput) {
      const val = store.totalSeats || 0;
      seatsInput.value = val;
      seatsInput.dataset.value = val;
    }
    if (outletsInput) {
      const val = store.availableOutlets || 0;
      outletsInput.value = val;
      outletsInput.dataset.value = val;
    }
    if (wifiSelect) wifiSelect.value = store.wifiQuality || 'none';
    
    if (parkingToggle) {
      parkingToggle.checked = !!store.parkingEnabled;
      if (parkingSubpanel) {
        if (store.parkingEnabled) {
          parkingSubpanel.classList.add('open');
        } else {
          parkingSubpanel.classList.remove('open');
        }
      }
    }
    
    if (parkingSurface) parkingSurface.checked = store.parkingType ? store.parkingType.includes('surface') : false;
    if (parkingMechanical) parkingMechanical.checked = store.parkingType ? store.parkingType.includes('mechanical') : false;
    if (parkingCapacity) parkingCapacity.value = store.parkingCapacity || 0;
  },

  init() {
    // 1. Entry / Back navigation
    const btnEnter = document.getElementById('btn-enter-boss');
    const btnBack = document.getElementById('btn-boss-back');
    const viewMypage = document.getElementById('view-mypage');
    const viewBoss = document.getElementById('view-boss');
    
    if (btnEnter && viewMypage && viewBoss) {
      btnEnter.addEventListener('click', () => {
        viewMypage.style.display = 'none';
        viewBoss.style.display = 'block';
        this.loadStoreDetails();
      });
    }
    if (btnBack && viewMypage && viewBoss) {
      btnBack.addEventListener('click', () => {
        viewBoss.style.display = 'none';
        viewMypage.style.display = 'block';
      });
    }
    
    // 2. POS Integration Toggle logic
    const posToggle = document.getElementById('boss-pos-toggle');
    const statusActive = document.getElementById('pos-status-active');
    const manualContainer = document.getElementById('pos-manual-select-container');
    
    if (posToggle && statusActive && manualContainer) {
      if (posToggle.checked) {
        statusActive.style.display = 'flex';
        manualContainer.style.display = 'none';
      } else {
        statusActive.style.display = 'none';
        manualContainer.style.display = 'block';
      }

      posToggle.addEventListener('change', (e) => {
        if (e.target.checked) {
          statusActive.style.display = 'flex';
          manualContainer.style.display = 'none';
        } else {
          statusActive.style.display = 'none';
          manualContainer.style.display = 'block';
        }
      });
    }
    
    // Parking Toggle Sub-panel logic
    const parkingToggle = document.getElementById('boss-parking-toggle');
    const parkingSubpanel = document.getElementById('boss-parking-subpanel');
    if (parkingToggle && parkingSubpanel) {
      parkingToggle.addEventListener('change', (e) => {
        if (e.target.checked) {
          parkingSubpanel.classList.add('open');
        } else {
          parkingSubpanel.classList.remove('open');
        }
      });
    }

    // 3. Infrastructure save overhaul trigger
    const btnSaveInfra = document.getElementById('btn-save-infra');
    if (btnSaveInfra) {
      btnSaveInfra.addEventListener('click', () => {
        const store = this.getStore();
        
        const seatsInput = document.getElementById('boss-seats-count');
        const outletsInput = document.getElementById('boss-outlets-count');
        const wifiSelect = document.getElementById('boss-wifi-availability');
        const parkingToggleVal = document.getElementById('boss-parking-toggle');
        const parkingSurface = document.getElementById('parking-type-surface');
        const parkingMechanical = document.getElementById('parking-type-mechanical');
        const parkingCapacity = document.getElementById('boss-parking-capacity');

        if (seatsInput) store.totalSeats = parseInt(seatsInput.value || seatsInput.dataset.value || seatsInput.textContent, 10) || 0;
        if (outletsInput) store.availableOutlets = parseInt(outletsInput.value || outletsInput.dataset.value || outletsInput.textContent, 10) || 0;
        if (wifiSelect) store.wifiQuality = wifiSelect.value;
        if (parkingToggleVal) store.parkingEnabled = parkingToggleVal.checked;
        
        const parkingType = [];
        if (parkingSurface && parkingSurface.checked) parkingType.push('surface');
        if (parkingMechanical && parkingMechanical.checked) parkingType.push('mechanical');
        store.parkingType = parkingType;
        
        if (parkingCapacity) store.parkingCapacity = parseInt(parkingCapacity.value, 10) || 0;

        // Synchronize store features array
        const newFeatures = [];
        if (store.availableOutlets > 0) newFeatures.push('콘센트');
        if (store.features && store.features.includes('단체석')) {
          newFeatures.push('단체석');
        }
        if (store.parkingEnabled) newFeatures.push('주차');
        
        store.features = newFeatures;

        // Refresh map markers in real-time
        KakaoMapManager.filterMarkers(Array.from(FilterModule.activeFilters));

        this.showToast('세부 인프라 정보가 포털 및 지도에 실시간 반영되었습니다.');
      });
    }
    
    // 4. Congestion manual save toast trigger
    const btnSaveCongestion = document.getElementById('btn-save-congestion');
    if (btnSaveCongestion) {
      btnSaveCongestion.addEventListener('click', () => {
        const store = this.getStore();
        const manualCongestion = document.querySelector('input[name="manual-congestion"]:checked');
        if (manualCongestion && store) {
          store.congestion = manualCongestion.value;
          KakaoMapManager.filterMarkers(Array.from(FilterModule.activeFilters));
        }
        this.showToast('혼잡도 정보가 업데이트되었습니다.');
      });
    }
    
    // 5. Operating status buttons toggle active state
    const btnOpen = document.getElementById('btn-status-open');
    const btnClosed = document.getElementById('btn-status-closed');
    if (btnOpen && btnClosed) {
      btnOpen.addEventListener('click', () => {
        btnOpen.classList.add('active');
        btnClosed.classList.remove('active');
        this.showToast('영업 상태가 [영업 중]으로 변경되었습니다.');
      });
      btnClosed.addEventListener('click', () => {
        btnClosed.classList.add('active');
        btnOpen.classList.remove('active');
        this.showToast('영업 상태가 [영업 종료]로 변경되었습니다.');
      });
    }
    
    // 6. Notice submission toast trigger
    const btnSubmitNotice = document.getElementById('btn-submit-notice');
    const noticeInput = document.getElementById('boss-notice-input');
    if (btnSubmitNotice && noticeInput) {
      btnSubmitNotice.addEventListener('click', () => {
        const text = noticeInput.value.trim();
        if (text) {
          this.showToast('한줄 공지가 등록되었습니다.');
        } else {
          this.showToast('공지 내용을 입력해 주세요.');
        }
      });
    }
  },
  showToast(message) {
    const toast = document.getElementById('boss-toast');
    if (toast) {
      toast.textContent = message;
      toast.classList.add('visible');
      if (this.toastTimeout) {
        clearTimeout(this.toastTimeout);
      }
      this.toastTimeout = setTimeout(() => {
        toast.classList.remove('visible');
      }, 2000);
    }
  }
};

// ─── 9. SPLASH MODULE ─────────────────────────────────────
const SplashModule = {
  currentStep: 'logo',
  selectedPurposes: new Set(),

  init() {
    // If query bypass set, handled in global DomContentLoaded
    // Else show role step after 1.5s
    setTimeout(() => this.goToStep('role'), 1500);

    // Role card clicks
    document.getElementById('role-user')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.goToStep('social');
    });
    document.getElementById('role-boss')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.goToStep('boss');
    });
    
    // Backdrop click to close overlay (if clicking outside)
    document.getElementById('view-splash')?.addEventListener('click', (e) => {
      if (e.target.id === 'view-splash') {
        this.goToStep('role');
      }
    });
    document.getElementById('guest-link')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setSession('guest');
      this.goToStep('checklist');
    });

    // Social login buttons → all go to checklist
    ['splash-login-kakao', 'splash-login-naver', 'splash-login-google'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setSession('user');
        this.goToStep('checklist');
      });
    });

    // Back buttons
    document.getElementById('splash-back-social')?.addEventListener('click', (e) => { e.stopPropagation(); this.goToStep('role'); });
    document.getElementById('splash-back-boss')?.addEventListener('click', (e) => { e.stopPropagation(); this.goToStep('role'); });

    // Checklist item toggles
    const checklistGrid = document.getElementById('checklist-grid');
    if (checklistGrid) {
      checklistGrid.addEventListener('click', (e) => {
        const item = e.target.closest('.checklist-item');
        if (!item) return;
        item.classList.toggle('selected');
        const purpose = item.dataset.purpose;
        if (item.classList.contains('selected')) {
          this.selectedPurposes.add(purpose);
          item.querySelector('.check-icon').textContent = '✓';
        } else {
          this.selectedPurposes.delete(purpose);
          item.querySelector('.check-icon').textContent = '';
        }
      });
    }

    // Checklist submit
    document.getElementById('btn-checklist-submit')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.applyFilters();
      this.dismiss();
    });

    // Boss verification submit
    document.getElementById('btn-boss-verify-submit')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const input = document.getElementById('boss-verify-input');
      // Submitting any numeric value immediately routes to boss dashboard
      if (input && input.value.trim().length > 0) {
        this.setSession('boss');
        this.dismiss();
        
        setTimeout(() => {
          const viewMypage = document.getElementById('view-mypage');
          const viewBoss = document.getElementById('view-boss');
          if (viewMypage && viewBoss) {
            BottomNav.switchTab('mypage');
            viewMypage.style.display = 'none';
            viewBoss.style.display = 'block';
            BossCenterModule.loadStoreDetails();
          }
        }, 300);
      }
    });

    // Auto-focus boss input on keystroke entry check
    const bossInput = document.getElementById('boss-verify-input');
    if (bossInput) {
      bossInput.addEventListener('input', (e) => {
        // Strip out non-numeric characters to focus input strictly on registration format
        bossInput.value = bossInput.value.replace(/[^0-9]/g, '');
      });
    }
  },

  goToStep(step) {
    document.querySelectorAll('.splash-step').forEach(s => s.classList.remove('active'));
    
    if (step === 'role') {
      const roleStep = document.getElementById('splash-step-role');
      if (roleStep) {
        roleStep.style.display = 'flex';
        roleStep.classList.add('active');
      }
    } else {
      const target = document.getElementById(`splash-step-${step}`);
      if (target) {
        target.classList.add('active');
      }
    }
    
    this.currentStep = step;
    
    // Auto-focus boss input
    if (step === 'boss') {
      setTimeout(() => document.getElementById('boss-verify-input')?.focus(), 300);
    }
  },

  setSession(type) {
    sessionType = type;
  },

  applyFilters() {
    // Map checklist to SOS filters
    const filterMap = {
      'notebook': ['콘센트', '와이파이'],
      'team': ['단체석'],
      'study': ['콘센트'],
      'reading': []
    };

    const filtersToActivate = new Set();
    this.selectedPurposes.forEach(purpose => {
      (filterMap[purpose] || []).forEach(f => filtersToActivate.add(f));
    });

    // Activate the corresponding filter chips
    filtersToActivate.forEach(filterName => {
      const chip = document.querySelector(`.chip[data-filter="${filterName}"]`);
      if (chip && !chip.classList.contains('active')) {
        chip.classList.add('active');
        FilterModule.activeFilters.add(filterName);
      }
    });

    // Refresh markers with new filters
    if (FilterModule.activeFilters.size > 0) {
      KakaoMapManager.filterMarkers(Array.from(FilterModule.activeFilters));
    }
  },

  dismiss() {
    const splash = document.getElementById('view-splash');
    if (splash) splash.classList.add('hidden');
  }
};

// ─── 10. STEPPER UI WIRING ────────────────────────────────
function initSteppers() {
  document.querySelectorAll('.stepper-container').forEach(container => {
    const valueEl = container.querySelector('.stepper-value');
    if (!valueEl) return;

    container.querySelectorAll('.stepper-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        let val = parseInt(valueEl.value, 10);
        if (isNaN(val)) val = parseInt(valueEl.dataset.value || valueEl.textContent, 10) || 0;
        
        if (btn.dataset.action === 'plus') val++;
        else if (btn.dataset.action === 'minus' && val > 0) val--;
        
        valueEl.value = val;
        valueEl.dataset.value = val;
        valueEl.textContent = val;
      });
    });

    // Direct manual type overrides instantly focusing mobile keyboard
    valueEl.addEventListener('input', () => {
      let val = parseInt(valueEl.value, 10);
      if (isNaN(val)) val = 0;
      valueEl.dataset.value = val;
      valueEl.textContent = val;
    });
  });
}

// ─── 11. INITIALIZATION ────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Parse query bypass parameters first (for automated E2E tests, clean url thereafter)
  const urlParams = new URLSearchParams(window.location.search);
  const bypass = urlParams.get('bypass_splash');
  if (bypass === 'user') {
    sessionType = 'user';
    const splash = document.getElementById('view-splash');
    if (splash) splash.classList.add('hidden');
    history.replaceState({}, document.title, window.location.pathname);
  } else if (bypass === 'boss') {
    sessionType = 'boss';
    const splash = document.getElementById('view-splash');
    if (splash) splash.classList.add('hidden');
    // Swerve directly to Boss dashboard
    setTimeout(() => {
      const viewMypage = document.getElementById('view-mypage');
      const viewBoss = document.getElementById('view-boss');
      if (viewMypage && viewBoss) {
        BottomNav.switchTab('mypage');
        viewMypage.style.display = 'none';
        viewBoss.style.display = 'block';
        BossCenterModule.loadStoreDetails();
      }
    }, 100);
    history.replaceState({}, document.title, window.location.pathname);
  }

  SplashModule.init();
  KakaoMapManager.init();
  FilterModule.init();
  BottomSheet.init();
  BottomNav.init();
  CafeDetailModal.init();
  FavoritesModule.init();
  SearchModule.init();
  MyPageModule.init();
  BossCenterModule.init();
  initSteppers();

  // ── Frictionless Dismissal: fallback click map to close detail modal ──
  const mapEl = document.getElementById('kakao-map');
  if (mapEl) {
    mapEl.addEventListener('click', (e) => {
      // Only dismiss if clicking directly on the map, not on a marker
      if (e.target === mapEl || e.target.closest('.map-container') || e.target.id === 'kakao-map') {
        if (CafeDetailModal.modal && CafeDetailModal.modal.classList.contains('visible')) {
          CafeDetailModal.hide();
        }
      }
    });
  }

  // ── Frictionless Dismissal: swipe down on detail modal ──
  const detailModal = document.getElementById('cafe-detail-modal');
  if (detailModal) {
    let touchStartY = 0;
    detailModal.addEventListener('touchstart', (e) => {
      touchStartY = e.touches[0].clientY;
    }, { passive: true });
    detailModal.addEventListener('touchmove', (e) => {
      const diff = e.touches[0].clientY - touchStartY;
      if (diff > 60) {
        CafeDetailModal.hide();
      }
    }, { passive: true });
  }

  // ── My Page Guest Protection ──
  const origSwitchTab = BottomNav.switchTab.bind(BottomNav);
  BottomNav.switchTab = function(tabId) {
    origSwitchTab(tabId);
    
    // Hide guest placeholder in case we switch away
    const placeholder = document.getElementById('guest-mypage-placeholder');
    if (placeholder && tabId !== 'mypage') {
      placeholder.remove();
    }
    
    if (tabId === 'mypage' && sessionType === 'guest') {
      const viewMypage = document.getElementById('view-mypage');
      if (viewMypage) {
        // Hide profile and menu, show guest placeholder
        const profileCard = viewMypage.querySelector('.profile-card');
        const menuList = viewMypage.querySelector('.menu-list');
        const bossBanner = viewMypage.querySelector('.boss-entry-banner');
        if (profileCard) profileCard.style.display = 'none';
        if (menuList) menuList.style.display = 'none';
        if (bossBanner) bossBanner.style.display = 'none';

        // Add guest placeholder if not already there
        if (!document.getElementById('guest-mypage-placeholder')) {
          const placeholder = document.createElement('div');
          placeholder.id = 'guest-mypage-placeholder';
          placeholder.className = 'guest-placeholder';
          placeholder.innerHTML = `
            <span class="material-icons-round">lock</span>
            <div class="guest-msg">로그인이 필요합니다</div>
            <div class="guest-sub">로그인하면 즐겨찾기, 리뷰 관리 등<br>다양한 기능을 이용할 수 있어요!</div>
            <button class="btn-guest-login" onclick="location.reload();">로그인하기</button>
          `;
          viewMypage.appendChild(placeholder);
        }
      }
    }
  };
});
