    // FIREBASE CONFIGURATION
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
    import { getFirestore, collection, query, orderBy, onSnapshot, setDoc, doc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

    const firebaseConfig = {
      apiKey: "AIzaSyCftljTkWcA2-CyojsF40Dpjm9rAiSlKNc",
      authDomain: "plexmovies-530e4.firebaseapp.com",
      projectId: "plexmovies-530e4",
      storageBucket: "plexmovies-530e4.firebasestorage.app",
      messagingSenderId: "890489788932",
      appId: "1:890489788932:web:7b606cb4a67ba70b23f351",
      measurementId: "G-ZBZ7YQ1GYR"
    };

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);
    const TMDB_KEY = '5e30970a964f6e59d184fa77433b17ca';

    let globalRequests = []; // Stores live Firestore data
    let currentMovies = []; // Stores current TMDB movie results
    let currentTVShows = []; // Stores current TMDB TV results
    let currentComingSoon = []; // Stores upcoming movies
    let trackedShows = []; // Stores tracked TV shows
    let newEpisodes = []; // Stores new episodes from tracked shows
    let currentTab = 'movies';
    let currentMoviePage = 1;
    let currentTVPage = 1;

    // AUTO-REFRESH HELPERS - CHANGED TO DAILY
    const DAY_MS = 24 * 60 * 60 * 1000; // 1 day (24 hours)
    const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000; // 2 weeks

    function shouldRefresh(key, maxAge) {
      const cached = localStorage.getItem(key);
      if (!cached) return true;
      const data = JSON.parse(cached);
      return Date.now() - data.timestamp > maxAge;
    }

    function cacheData(key, data) {
      localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
    }

    function getCached(key) {
      const cached = localStorage.getItem(key);
      return cached ? JSON.parse(cached).data : null;
    }

    function getLastRefresh(key) {
      const cached = localStorage.getItem(key);
      if (!cached) return 'Never';
      const timestamp = JSON.parse(cached).timestamp;
      const date = new Date(timestamp);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function updateLastRefreshUI() {
      const mostRecent = Math.max(
        JSON.parse(localStorage.getItem('trending_movies') || '{"timestamp":0}').timestamp,
        JSON.parse(localStorage.getItem('trending_tv') || '{"timestamp":0}').timestamp,
        JSON.parse(localStorage.getItem('coming_soon') || '{"timestamp":0}').timestamp
      );

      if (mostRecent === 0) {
        document.getElementById('update-time').textContent = 'Just now';
      } else {
        const date = new Date(mostRecent);
        document.getElementById('update-time').textContent = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    }

    // 1. LISTEN TO FIREBASE REAL-TIME
    onSnapshot(query(collection(db, "requests"), orderBy("timestamp", "desc")), (snapshot) => {
      globalRequests = [];
      snapshot.forEach(doc => globalRequests.push({ ...doc.data(), firestoreId: doc.id }));
      console.log('=== FIREBASE UPDATED ===');
      console.log('Total requests:', globalRequests.length);
      console.log('Sample item:', globalRequests[0]);
      if (globalRequests[0]) {
        console.log('Sample has overview:', !!globalRequests[0].overview);
        console.log('Sample has poster:', !!globalRequests[0].poster_path);
      }
      updateUI();
    });

    // INITIALIZATION - Call on page load
    async function initApp() {
      try {
        // Hide all loaders initially
        document.getElementById('loader-movies').style.display = 'none';
        document.getElementById('loader-tv').style.display = 'none';
        document.getElementById('loader-coming').style.display = 'none';

        // Load trending movies
        // Load trending movies
        await fetchMovies(1, false);

        updateLastRefreshUI();
      } catch (e) {
        console.error('Init error:', e);
        // Hide loaders even on error
        document.getElementById('loader-movies').style.display = 'none';
        document.getElementById('loader-tv').style.display = 'none';
        document.getElementById('loader-coming').style.display = 'none';
      }
    }

    // Call init when page loads
    initApp();

    // 2. FETCH TRENDING MOVIES (with auto-refresh - DAILY)
    // 2. FETCH TRENDING MOVIES (with auto-refresh - DAILY) - REPLACED BY UNIFIED FETCH
    // fetchTrending removed


    // 3. FETCH TRENDING TV SHOWS (with auto-refresh - DAILY)
    async function fetchTrendingTV(page = 1, append = false) {
      // Check cache first only on first page - NOW DAILY
      if (page === 1 && !append && !shouldRefresh('trending_tv', DAY_MS)) {
        const cached = getCached('trending_tv');
        if (cached) {
          currentTVShows = cached;
          renderGrid(currentTVShows, 'grid-tvshows');
          updateLastRefreshUI();
          return;
        }
      }

      document.getElementById('loader-tv').style.display = 'flex';
      try {
        const res = await fetch(`https://api.themoviedb.org/3/trending/tv/week?api_key=${TMDB_KEY}&page=${page}`);
        const data = await res.json();
        const newShows = data.results.map(tv => ({
          ...tv,
          mediaType: 'tv',
          title: tv.name,
          release_date: tv.first_air_date
        }));

        if (append) {
          currentTVShows = [...currentTVShows, ...newShows];
        } else {
          currentTVShows = newShows;
        }

        if (page === 1) cacheData('trending_tv', currentTVShows);
        renderGrid(currentTVShows, 'grid-tvshows');
        updateLastRefreshUI();
      } catch (e) { console.error("TMDB TV Fetch Error", e); }
      document.getElementById('loader-tv').style.display = 'none';
    }

    // 3B. FETCH COMING SOON MOVIES (with auto-refresh every 2 weeks)
    async function fetchComingSoon() {
      // Check cache first
      if (!shouldRefresh('coming_soon', TWO_WEEKS_MS)) {
        const cached = getCached('coming_soon');
        if (cached) {
          // Filter out past releases
          const today = new Date().toISOString().split('T')[0];
          currentComingSoon = cached.filter(m => m.release_date >= today);
          renderGrid(currentComingSoon, 'grid-coming');
          updateLastRefreshUI();
          return;
        }
      }

      document.getElementById('loader-coming').style.display = 'flex';
      try {
        const today = new Date().toISOString().split('T')[0];
        const futureDate = new Date();
        futureDate.setMonth(futureDate.getMonth() + 3);
        const future = futureDate.toISOString().split('T')[0];

        const res = await fetch(`https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}&primary_release_date.gte=${today}&primary_release_date.lte=${future}&sort_by=popularity.desc`);
        const data = await res.json();
        currentComingSoon = data.results.map(m => ({ ...m, mediaType: 'movie' }));
        cacheData('coming_soon', currentComingSoon);
        renderGrid(currentComingSoon, 'grid-coming');
        updateLastRefreshUI();
      } catch (e) { console.error("TMDB Coming Soon Error", e); }
      document.getElementById('loader-coming').style.display = 'none';
    }

    // 3C. TOOLBAR ACTIONS
    window.forceRefreshMovies = () => {
      localStorage.removeItem('trending_movies');
      fetchMovies(1, false);
    };

    window.clearMovieFilters = () => {
      document.getElementById('movie-genre').value = '';
      document.getElementById('movie-sort').value = 'trending';
      document.getElementById('movie-rating-filter').value = 'all';
      document.getElementById('movie-year-filter').value = 'all';
      fetchMovies(1, false);
    };

    window.loadMoreMovies = () => {
      fetchMovies(currentMoviePage + 1, true);
    };

    // UNIFIED FETCH FUNCTION
    async function fetchMovies(page = 1, append = false) {
      currentMoviePage = page;
      const genre = document.getElementById('movie-genre').value;
      const sort = document.getElementById('movie-sort').value;
      const rating = document.getElementById('movie-rating-filter').value;
      const year = document.getElementById('movie-year-filter').value;

      console.log(`=== FETCHING MOVIES (Page ${page}) ===`);
      console.log('Filters:', { genre, sort, rating, year });

      // Determine if using default "Trending" view (no filters)
      const isDefault = sort === 'trending' && !genre && rating === 'all' && year === 'all';

      // Check cache ONLY if no filters are active and it's page 1
      if (page === 1 && !append && isDefault && !shouldRefresh('trending_movies', DAY_MS)) {
        const cached = getCached('trending_movies');
        if (cached) {
          console.log('Using cached trending movies');
          currentMovies = cached;
          renderGrid(currentMovies, 'grid-movies');
          updateLastRefreshUI();
          document.getElementById('loader-movies').style.display = 'none';
          return;
        }
      }

      // Show loader if not appending
      if (!append) {
        document.getElementById('loader-movies').style.display = 'flex';
        document.getElementById('grid-movies').innerHTML = '';
      }

      let apiUrl = `https://api.themoviedb.org/3/`;
      const params = new URLSearchParams({
        api_key: TMDB_KEY,
        page: page,
        include_adult: false,
        'vote_count.gte': 50
      });

      // Construct API Call
      if (sort === 'trending' && !genre && rating === 'all' && year === 'all') {
        // Default Trending
        apiUrl += `trending/movie/week?`;
      } else {
        // Discover endpoint for any filter/sort combo
        apiUrl += 'discover/movie?';

        // Sort
        if (sort === 'trending') params.append('sort_by', 'popularity.desc'); // Default for discover
        else if (sort === 'rating') params.append('sort_by', 'vote_average.desc');
        else if (sort === 'year') params.append('sort_by', 'primary_release_date.desc');
        else if (sort === 'title') params.append('sort_by', 'original_title.asc');
        else if (sort === 'popularity') params.append('sort_by', 'popularity.desc');

        // Genre
        if (genre) params.append('with_genres', genre);

        // Rating
        if (rating === 'high') params.append('vote_average.gte', '8.0');
        else if (rating === 'mid') { params.append('vote_average.gte', '6.0'); params.append('vote_average.lte', '7.9'); }
        else if (rating === 'low') params.append('vote_average.lte', '5.9');

        // Year
        const currentYear = new Date().getFullYear();
        if (year === '2024') { params.append('primary_release_date.gte', '2024-01-01'); params.append('primary_release_date.lte', `${currentYear}-12-31`); }
        else if (year === '2020') { params.append('primary_release_date.gte', '2020-01-01'); params.append('primary_release_date.lte', '2023-12-31'); }
        else if (year === '2010') { params.append('primary_release_date.gte', '2010-01-01'); params.append('primary_release_date.lte', '2019-12-31'); }
        else if (year === '2000') { params.append('primary_release_date.gte', '2000-01-01'); params.append('primary_release_date.lte', '2009-12-31'); }
        else if (year === 'classic') params.append('primary_release_date.lte', '1999-12-31');
      }

      try {
        const res = await fetch(apiUrl + params.toString());
        const data = await res.json();
        const newMovies = data.results.map(m => ({ ...m, mediaType: 'movie' }));

        if (append) {
          currentMovies = [...currentMovies, ...newMovies];
          // Determine unique items to render
          renderGrid(newMovies, 'grid-movies', true); // Add append mode to renderGrid if needed, or just append manually
        } else {
          currentMovies = newMovies;
          renderGrid(currentMovies, 'grid-movies');

          // Cache if this is the default view
          if (page === 1 && isDefault) {
            cacheData('trending_movies', currentMovies);
            updateLastRefreshUI();
          }
        }
      } catch (e) {
        console.error('Fetch movies error:', e);
      } finally {
        document.getElementById('loader-movies').style.display = 'none';
      }
    }

    window.forceRefreshTV = () => {
      localStorage.removeItem('trending_tv');
      currentTVPage = 1;
      currentTVShows = []; // Clear existing
      fetchTrendingTV(1, false);
    };

    window.loadMoreTV = () => {
      currentTVPage++;
      console.log('Loading TV page:', currentTVPage);
      fetchTrendingTV(currentTVPage, true);
    };

    // 3D. SCROLL TO TOP FUNCTIONALITY
    window.scrollToTop = () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // Show/hide scroll button based on scroll position
    window.addEventListener('scroll', () => {
      const scrollBtn = document.getElementById('scroll-to-top');
      if (window.scrollY > 300) {
        scrollBtn.classList.add('visible');
      } else {
        scrollBtn.classList.remove('visible');
      }
    });

    // 3E. TV SHOW TRACKING SYSTEM
    // Listen to tracked shows in Firebase
    onSnapshot(collection(db, "tracked_shows"), (snapshot) => {
      trackedShows = [];
      snapshot.forEach(doc => trackedShows.push({ docId: doc.id, ...doc.data() }));
      renderTrackedShows();
      // REMOVED auto-check to prevent popup on load
    });

    // Add show to tracking - Updated to use search in Track Shows tab
    window.showAddShowModal = () => {
      const searchQuery = prompt("Enter TV show name to track:");
      if (!searchQuery) return;

      fetch(`https://api.themoviedb.org/3/search/tv?api_key=${TMDB_KEY}&query=${encodeURIComponent(searchQuery)}`)
        .then(res => res.json())
        .then(data => {
          if (data.results && data.results.length > 0) {
            const show = data.results[0];
            addShowToTracking(show);
          } else {
            alert("Show not found!");
          }
        });
    };

    async function addShowToTracking(show) {
      try {
        await setDoc(doc(db, "tracked_shows", `tv_${show.id}`), {
          id: show.id,
          name: show.name,
          poster_path: show.poster_path,
          first_air_date: show.first_air_date,
          last_checked: Date.now(),
          last_episode_date: null,
          auto_request: false
        });
        alert(`Now tracking: ${show.name}`);
      } catch (e) {
        console.error("Error tracking show:", e);
      }
    }

    // Check for new episodes (manual)
    window.checkForNewEpisodes = async () => {
      if (trackedShows.length === 0) {
        alert("You're not tracking any shows yet!");
        return;
      }

      document.getElementById('grid-episodes').innerHTML = '<div style="text-align:center; padding:40px;"><i class="fa-solid fa-spinner fa-spin fa-3x"></i></div>';

      newEpisodes = [];
      const today = new Date().toISOString().split('T')[0];

      for (const show of trackedShows) {
        try {
          const res = await fetch(`https://api.themoviedb.org/3/tv/${show.id}?api_key=${TMDB_KEY}&append_to_response=season/1`);
          const data = await res.json();

          if (data.last_episode_to_air && data.last_episode_to_air.air_date === today) {
            newEpisodes.push({
              ...data,
              episode: data.last_episode_to_air,
              tracked_show: show
            });

            // Auto-request if enabled
            if (show.auto_request) {
              await autoRequestEpisode(data, show);
            }
          }
        } catch (e) {
          console.error(`Error checking ${show.name}:`, e);
        }
      }

      renderNewEpisodes();
    };

    // Auto-check daily (called when tracked shows load)
    async function checkForNewEpisodesAuto() {
      const lastCheck = localStorage.getItem('last_episode_check');
      const today = new Date().toISOString().split('T')[0];

      if (lastCheck !== today) {
        localStorage.setItem('last_episode_check', today);
        await window.checkForNewEpisodes();
      }
    }

    async function autoRequestEpisode(showData, trackedShow) {
      const episode = showData.last_episode_to_air;
      const title = `${showData.name} - S${episode.season_number}E${episode.episode_number}`;

      try {
        await setDoc(doc(db, "requests", `tv_${showData.id}_${episode.id}`), {
          id: showData.id,
          mediaType: 'tv',
          title: title,
          poster_path: showData.poster_path,
          backdrop_path: showData.backdrop_path,
          overview: episode.overview || showData.overview,
          release_date: episode.air_date,
          vote_average: showData.vote_average,
          status: 'pending',
          note: `Auto-requested new episode`,
          requester: 'Auto-Tracker',
          priority: 'normal',
          timestamp: Date.now()
        });
      } catch (e) {
        console.error("Auto-request failed:", e);
      }
    }

    function renderTrackedShows() {
      const grid = document.getElementById('grid-tracking');
      const noTracking = document.getElementById('no-tracking');

      if (trackedShows.length === 0) {
        grid.innerHTML = '';
        noTracking.style.display = 'block';
        return;
      }

      noTracking.style.display = 'none';
      grid.innerHTML = '';

      trackedShows.forEach(show => {
        const card = document.createElement('div');
        card.className = 'movie-card';
        card.innerHTML = `
          <div class="poster-wrapper">
            <img src="https://image.tmdb.org/t/p/w500${show.poster_path}" class="poster-img" loading="lazy">
          </div>
          <div class="card-content">
            <div class="movie-title">${show.name}</div>
            <div class="btn-wrapper">
              <button class="btn-card" onclick="toggleAutoRequest('${show.docId}', ${!show.auto_request})" style="background: ${show.auto_request ? 'var(--green)' : 'var(--text-muted)'}">
                <i class="fa-solid fa-robot"></i> Auto-Request: ${show.auto_request ? 'ON' : 'OFF'}
              </button>
              <button class="btn-card" onclick="untrackShow('${show.docId}')" style="background: var(--red)">
                <i class="fa-solid fa-trash"></i> Untrack
              </button>
            </div>
          </div>
        `;
        grid.appendChild(card);
      });
    }

    function renderNewEpisodes() {
      const grid = document.getElementById('grid-episodes');
      const noEpisodes = document.getElementById('no-episodes');

      if (newEpisodes.length === 0) {
        grid.innerHTML = '';
        noEpisodes.style.display = 'block';
        return;
      }

      noEpisodes.style.display = 'none';
      grid.innerHTML = '';

      newEpisodes.forEach(item => {
        const ep = item.episode;
        const card = document.createElement('div');
        card.className = 'movie-card';
        card.style.boxShadow = '0 4px 20px rgba(76, 175, 80, 0.5)'; // Green glow

        card.innerHTML = `
          <div class="poster-wrapper">
            <img src="https://image.tmdb.org/t/p/w500${item.poster_path}" class="poster-img" loading="lazy">
            <div class="priority-badge" style="background: var(--green);"><i class="fa-solid fa-bell"></i> NEW!</div>
          </div>
          <div class="card-content">
            <div class="movie-title">${item.name}</div>
            <div class="movie-year">S${ep.season_number}E${ep.episode_number} - ${ep.name}</div>
            <div class="movie-note">"${ep.overview || 'New episode released today!'}"</div>
            <div class="btn-wrapper">
              <button class="btn-card btn-request" onclick="requestEpisode(${JSON.stringify(item).replace(/"/g, '&quot;')}, ${JSON.stringify(ep).replace(/"/g, '&quot;')})">
                <i class="fa-solid fa-plus"></i> Request
              </button>
            </div>
          </div>
        `;
        grid.appendChild(card);
      });
    }

    window.requestEpisode = async (show, episode) => {
      const title = `${show.name} - S${episode.season_number}E${episode.episode_number}`;
      await saveItemFromObject({
        id: show.id,
        mediaType: 'tv',
        title: title,
        poster_path: show.poster_path,
        backdrop_path: show.backdrop_path,
        overview: episode.overview || show.overview,
        release_date: episode.air_date,
        vote_average: show.vote_average
      }, 'pending', `Episode: ${episode.name}`, 'User', 'normal');
      alert(`Requested: ${title}`);
    };

    window.toggleAutoRequest = async (docId, enabled) => {
      try {
        await updateDoc(doc(db, "tracked_shows", docId), {
          auto_request: enabled
        });
      } catch (e) {
        console.error("Error toggling auto-request:", e);
      }
    };

    window.untrackShow = async (docId) => {
      if (confirm("Stop tracking this show?")) {
        try {
          await deleteDoc(doc(db, "tracked_shows", docId));
        } catch (e) {
          console.error("Error untracking:", e);
        }
      }
    };

    // 4. SEARCH LOGIC
    document.getElementById('search').addEventListener('input', async (e) => {
      const val = e.target.value;
      if (val.length > 2) {
        if (currentTab === 'movies') {
          document.getElementById('movie-header').innerHTML = `<i class="fa-solid fa-magnifying-glass"></i> Search Results`;
          const res = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(val)}`);
          const data = await res.json();
          currentMovies = data.results.map(m => ({ ...m, mediaType: 'movie' }));
          renderGrid(currentMovies, 'grid-movies');
        } else if (currentTab === 'tvshows') {
          document.getElementById('tv-header').innerHTML = `<i class="fa-solid fa-magnifying-glass"></i> Search Results`;
          const res = await fetch(`https://api.themoviedb.org/3/search/tv?api_key=${TMDB_KEY}&query=${encodeURIComponent(val)}`);
          const data = await res.json();
          currentTVShows = data.results.map(tv => ({
            ...tv,
            mediaType: 'tv',
            title: tv.name,
            release_date: tv.first_air_date
          }));
          renderGrid(currentTVShows, 'grid-tvshows');
        }
      } else if (val.length === 0) {
        if (currentTab === 'movies') {
          document.getElementById('movie-header').innerHTML = `<i class="fa-solid fa-fire"></i> Trending Movies`;
          fetchTrending();
        } else if (currentTab === 'tvshows') {
          document.getElementById('tv-header').innerHTML = `<i class="fa-solid fa-fire"></i> Trending TV Shows`;
          fetchTrendingTV();
        }
      }
    });

    // 5. GENRE/SORT FILTERS
    // 5. GENRE/SORT FILTERS - UNIFIED LISTENER
    ['movie-sort', 'movie-genre', 'movie-rating-filter', 'movie-year-filter'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => fetchMovies(1, false));
    });

    // Apply all movie filters at once - FETCH NEW DATA


    document.getElementById('tv-sort').addEventListener('change', async (e) => {
      const sort = e.target.value;
      if (sort === 'trending') fetchTrendingTV();
      else if (sort === 'rating') {
        currentTVShows.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
        renderGrid(currentTVShows, 'grid-tvshows');
      } else if (sort === 'year') {
        currentTVShows.sort((a, b) => (b.release_date || '').localeCompare(a.release_date || ''));
        renderGrid(currentTVShows, 'grid-tvshows');
      } else if (sort === 'title') {
        currentTVShows.sort((a, b) => a.title.localeCompare(b.title));
        renderGrid(currentTVShows, 'grid-tvshows');
      }
    });

    document.getElementById('tv-genre').addEventListener('change', async (e) => {
      const genre = e.target.value;
      if (!genre) {
        fetchTrendingTV();
      } else {
        const res = await fetch(`https://api.themoviedb.org/3/discover/tv?api_key=${TMDB_KEY}&with_genres=${genre}&sort_by=popularity.desc`);
        const data = await res.json();
        currentTVShows = data.results.map(tv => ({
          ...tv,
          mediaType: 'tv',
          title: tv.name,
          release_date: tv.first_air_date
        }));
        renderGrid(currentTVShows, 'grid-tvshows');
      }
    });

    // 6. RENDERING CARDS
    function renderGrid(items, targetId, append = false) {
      const grid = document.getElementById(targetId);
      if (!append) grid.innerHTML = '';
      if (!items || items.length === 0) {
        grid.innerHTML = `<p style="grid-column:1/-1; text-align:center; color:gray; padding:40px;">No items found.</p>`;
        return;
      }

      items.forEach(item => {
        const dbEntry = globalRequests.find(r => r.id === item.id && r.mediaType === item.mediaType);
        const isAdded = dbEntry?.status === 'added';
        const isPending = dbEntry?.status === 'pending';

        const card = document.createElement('div');
        card.className = `movie-card ${isAdded ? 'library-item' : ''}`;

        // Handle both TMDB format (poster_path) and stored format (poster full URL)
        let poster;
        if (item.poster_path) {
          poster = `https://image.tmdb.org/t/p/w500${item.poster_path}`;
        } else if (item.poster && item.poster.startsWith('http')) {
          poster = item.poster;
        } else {
          poster = 'https://via.placeholder.com/500x750/16161f/ffffff?text=No+Poster';
        }

        let year;
        let releaseDateBadge = '';

        // For Coming Soon, show full date instead of year
        if (targetId === 'grid-coming') {
          if (item.release_date) {
            const releaseDate = new Date(item.release_date);
            year = releaseDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            releaseDateBadge = `<div class="priority-badge" style="background: var(--blue); left: auto; right: 10px;"><i class="fa-solid fa-calendar"></i> ${year}</div>`;
          } else {
            year = 'TBD';
            releaseDateBadge = `<div class="priority-badge" style="background: var(--text-muted); left: auto; right: 10px;"><i class="fa-solid fa-calendar"></i> TBD</div>`;
          }
        } else {
          // For other tabs, show year
          year = item.release_date ? item.release_date.split('-')[0] : 'N/A';
        }

        card.innerHTML = `
        <div class="poster-wrapper">
          <label style="position:absolute; top:10px; left:10px; z-index:10; background:rgba(0,0,0,0.7); padding:8px; border-radius:8px; cursor:pointer;" onclick="event.stopPropagation()">
            <input type="checkbox" class="request-checkbox" data-item="${encodeURIComponent(JSON.stringify(item))}" style="width:20px; height:20px; cursor:pointer;">
          </label>
          <img src="${poster}" class="poster-img" loading="lazy">
          <div class="rating-badge"><i class="fa-solid fa-star"></i> ${item.vote_average?.toFixed(1) || 'NR'}</div>
          ${dbEntry?.priority === 'high' ? '<div class="priority-badge"><i class="fa-solid fa-fire"></i> HIGH</div>' : ''}
          ${releaseDateBadge}
        </div>
        <div class="card-content">
          <div class="movie-title">${item.title}</div>
          <div class="movie-year">${year}</div>
          ${dbEntry?.note ? `<div class="movie-note">"${dbEntry.note}"</div>` : ''}
          ${dbEntry?.requester ? `<div class="movie-year">Requested by: ${dbEntry.requester}</div>` : ''}
          <div class="btn-wrapper">
            ${isAdded ? '<button class="btn-card btn-status-available"><i class="fa-solid fa-circle-check"></i> Available</button>' :
            `<button class="btn-card btn-mark-added" onclick="event.stopPropagation(); window.saveItemFromObject(${JSON.stringify(item).replace(/"/g, '&quot;')}, 'added')"><i class="fa-solid fa-check"></i> Mark Available</button>
               <button class="btn-card btn-request ${isPending ? 'btn-status-requested' : ''}" onclick="event.stopPropagation(); if(!${isPending}) window.openRequestModal(${JSON.stringify(item).replace(/"/g, '&quot;')})">
                 ${isPending ? '<i class="fa-solid fa-hourglass-start"></i> Requested' : '<i class="fa-solid fa-plus"></i> Request'}
               </button>`}
          </div>
        </div>
      `;
        card.onclick = () => openDetail(item);
        grid.appendChild(card);
      });
    }

    // 7. REQUEST MODAL WITH NOTE & PRIORITY
    window.openRequestModal = (itemObj) => {
      const item = typeof itemObj === 'string' ? JSON.parse(itemObj) : itemObj;
      const overlay = document.getElementById('detail-overlay');
      overlay.innerHTML = `
      <div class="modal" style="max-width: 500px; padding: 40px;">
        <h2 style="margin-bottom: 20px;">Request: ${item.title}</h2>
        <input type="text" id="requester-name" class="modal-note-input" placeholder="Your name (optional)" style="height: 45px;">
        <textarea id="request-note" class="modal-note-input" placeholder="Add a note or reason for this request (optional)" rows="3"></textarea>
        <div style="margin-bottom: 15px;">
          <label style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 8px; display: block;">Priority Level:</label>
          <select id="request-priority" class="control-select" style="width: 100%;">
            <option value="normal">Normal</option>
            <option value="high">High Priority</option>
          </select>
        </div>
        <div style="display: flex; gap: 10px;">
          <button class="torrent-btn" style="flex: 1;" onclick="window.submitRequest(${JSON.stringify(item).replace(/"/g, '&quot;')})">
            <i class="fa-solid fa-paper-plane"></i> Submit Request
          </button>
          <button class="torrent-btn" style="background: #333;" onclick="document.getElementById('detail-overlay').classList.remove('open')">
            Cancel
          </button>
        </div>
      </div>
    `;
      overlay.classList.add('open');
    };

    window.submitRequest = async (itemObj) => {
      const item = typeof itemObj === 'string' ? JSON.parse(itemObj) : itemObj;
      const note = document.getElementById('request-note').value;
      const requester = document.getElementById('requester-name').value;
      const priority = document.getElementById('request-priority').value;

      await saveItemFromObject(item, 'pending', note, requester, priority);
      document.getElementById('detail-overlay').classList.remove('open');
    };

    // 8. DATABASE ACTIONS - Save complete item object
    window.saveItemFromObject = async (itemObj, status, note = '', requester = '', priority = 'normal', silent = false) => {
      try {
        const item = typeof itemObj === 'string' ? JSON.parse(itemObj) : itemObj;

        // Debug logging
        console.log('=== SAVING ITEM ===');
        console.log('Item received:', item);
        console.log('Has overview:', !!item.overview);
        console.log('Has poster_path:', !!item.poster_path);
        console.log('Status:', status);

        // Check if item already exists in DB to preserve data
        const existingItem = globalRequests.find(r => r.id === item.id && r.mediaType === (item.mediaType || 'movie'));
        console.log('Existing item found:', !!existingItem);

        // Preserve existing data if available
        const noteToSave = note || (existingItem ? existingItem.note : '');
        const requesterToSave = requester || (existingItem ? existingItem.requester : '');
        const priorityToSave = priority || (existingItem ? existingItem.priority : 'normal');

        const docId = `${item.mediaType || 'movie'}_${item.id}`;
        const timestamp = existingItem ? existingItem.timestamp : Date.now();

        await setDoc(doc(db, "requests", docId), {
          ...item,
          mediaType: item.mediaType || 'movie',
          timestamp: timestamp,
          status: status,
          note: noteToSave,
          requester: requesterToSave,
          priority: priorityToSave
        });

        console.log('✅ Item saved successfully:', docId);

        if (!silent) {
          if (status === 'added') alert(`"${item.title}" marked as available!`);
          else alert(`Request for "${item.title}" submitted!`);
          document.getElementById('detail-overlay').classList.remove('open');
        }
      } catch (e) {
        console.error("Error adding request: ", e);
        if (!silent) alert("Error saving request. See console for details.");
      }
    };
