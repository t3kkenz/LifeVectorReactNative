(function () {
  'use strict';

  var COLORS = ['#a8df65', '#aaa897', '#e15980', '#d99aa5', '#e1b75f', '#79a9d8'];
  var DEFAULT_PLACES = [
    { name: 'Home', color: '#a8df65' },
    { name: 'Class', color: '#aaa897' },
    { name: 'Library', color: '#e15980' },
    { name: 'Gym', color: '#d99aa5' }
  ];
  var state = { days: 7, filter: 'All', data: makeSampleData(), imported: false };
  var toastTimer;

  function pad(value) { return String(value).padStart(2, '0'); }
  function isoDate(date) { return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()); }
  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character];
    });
  }
  function hash(value) {
    var result = 0;
    for (var index = 0; index < value.length; index += 1) result = ((result << 5) - result) + value.charCodeAt(index);
    return Math.abs(result);
  }
  function placeColor(name, index) {
    var configured = state.data.places.find(function (place) { return place.name === name; });
    return configured && configured.color ? configured.color : COLORS[index % COLORS.length];
  }
  function minutesLabel(minutes) {
    var hours = Math.floor(minutes / 60);
    var remainder = Math.round(minutes % 60);
    if (!hours) return remainder + 'm';
    return hours + 'h' + (remainder ? ' ' + remainder + 'm' : '');
  }
  function shortDate(value) {
    return new Date(value + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function makeSampleData() {
    var places = DEFAULT_PLACES.map(function (place) { return { name: place.name, color: place.color }; });
    var days = [];
    var now = new Date();
    now.setHours(12, 0, 0, 0);
    for (var offset = 29; offset >= 0; offset -= 1) {
      var date = new Date(now);
      date.setDate(now.getDate() - offset);
      var weekDay = date.getDay();
      var weekend = weekDay === 0 || weekDay === 6;
      var wave = Math.sin(offset * .77);
      var values = {
        Home: Math.max(330, Math.round((weekend ? 590 : 430) + wave * 34 + (offset % 3) * 12)),
        Class: weekend ? Math.round(25 + (offset % 2) * 18) : Math.max(120, Math.round(238 + Math.cos(offset * .58) * 48)),
        Library: weekend ? Math.round(75 + (offset % 4) * 20) : Math.max(42, Math.round(112 + Math.sin(offset * .41) * 40)),
        Gym: (offset + weekDay) % 3 === 0 ? 74 : Math.max(18, Math.round(42 + Math.cos(offset * .83) * 21))
      };
      days.push({ date: isoDate(date), places: values });
    }
    return { places: places, days: days };
  }

  function visibleDays() { return state.data.days.slice(-state.days); }
  function preferredRange(dayCount) { return dayCount >= 30 ? 30 : dayCount >= 14 ? 14 : 7; }
  function totalsFor(days) {
    var totals = {};
    state.data.places.forEach(function (place) { totals[place.name] = 0; });
    days.forEach(function (day) {
      Object.keys(day.places).forEach(function (place) { totals[place] = (totals[place] || 0) + Number(day.places[place] || 0); });
    });
    return totals;
  }
  function placeEntries(totals) {
    return Object.keys(totals).map(function (name, index) {
      return { name: name, minutes: totals[name], color: placeColor(name, index) };
    }).sort(function (a, b) { return b.minutes - a.minutes; });
  }
  function routineScore(days, entries) {
    if (days.length < 2 || !entries.length) return 100;
    var distributions = days.map(function (day) {
      var total = Object.keys(day.places).reduce(function (sum, name) { return sum + Number(day.places[name] || 0); }, 0) || 1;
      return entries.map(function (entry) { return Number(day.places[entry.name] || 0) / total; });
    });
    var averages = entries.map(function (_, index) {
      return distributions.reduce(function (sum, row) { return sum + row[index]; }, 0) / distributions.length;
    });
    var deviation = distributions.reduce(function (outer, row) {
      return outer + row.reduce(function (inner, value, index) { return inner + Math.abs(value - averages[index]); }, 0);
    }, 0) / distributions.length;
    return Math.max(45, Math.min(98, Math.round(100 - deviation * 42)));
  }

  function renderOverview(days, entries) {
    var total = entries.reduce(function (sum, entry) { return sum + entry.minutes; }, 0);
    var score = routineScore(days, entries);
    var first = days[0];
    var last = days[days.length - 1];
    document.getElementById('date-range').textContent = first && last ? shortDate(first.date) + ' — ' + shortDate(last.date) : 'No tracked dates';
    document.getElementById('tracked-time').textContent = minutesLabel(total);
    document.getElementById('tracked-change').textContent = 'Across ' + days.length + ' tracked day' + (days.length === 1 ? '' : 's');
    document.getElementById('top-place').textContent = entries[0] ? entries[0].name : '—';
    document.getElementById('top-place-share').textContent = entries[0] && total ? Math.round(entries[0].minutes / total * 100) + '% of recorded time' : 'No place data';
    document.getElementById('days-captured').textContent = days.length + '/' + state.days;
    document.getElementById('coverage-label').textContent = days.length === state.days ? 'Complete coverage' : 'Partial coverage';
    document.getElementById('routine-score').textContent = score;
    document.getElementById('vector-title').textContent = score >= 88 ? 'A steady rhythm' : score >= 72 ? 'A balanced week' : 'A changing pattern';
    document.getElementById('last-sync').textContent = state.imported ? 'Imported in this session' : 'Updated just now';

    var vectorEntries = entries.slice(0, 4);
    var maximum = Math.max.apply(null, vectorEntries.map(function (entry) { return entry.minutes; }).concat([1]));
    document.querySelectorAll('.vector-ray').forEach(function (ray, index) {
      var entry = vectorEntries[index];
      ray.style.setProperty('--ray-color', entry ? entry.color : '#42453e');
      ray.style.setProperty('--ray-length', (entry ? 47 + (entry.minutes / maximum) * 52 : 44) + 'px');
      ray.style.opacity = entry ? '1' : '.25';
      ray.setAttribute('title', entry ? entry.name + ': ' + minutesLabel(entry.minutes) : 'No place');
    });
    document.getElementById('vector-legend').innerHTML = vectorEntries.map(function (entry) {
      return '<span class="legend-item" style="--place-color:' + entry.color + '"><i></i>' + escapeHtml(entry.name) + '</span>';
    }).join('');
  }

  function renderFilters(entries) {
    var filters = [{ name: 'All', color: '#191a18' }].concat(entries);
    document.getElementById('place-filters').innerHTML = filters.map(function (entry) {
      return '<button class="filter-button' + (state.filter === entry.name ? ' is-selected' : '') + '" type="button" data-place="' + escapeHtml(entry.name) + '" style="--place-color:' + entry.color + '"><i></i>' + escapeHtml(entry.name) + '</button>';
    }).join('');
  }

  function renderRhythm(days, entries) {
    var chart = document.getElementById('rhythm-chart');
    var maximumMinutes = Math.max.apply(null, days.map(function (day) {
      return Object.keys(day.places).reduce(function (sum, name) {
        return sum + (state.filter === 'All' || state.filter === name ? Number(day.places[name] || 0) : 0);
      }, 0);
    }).concat([720]));
    chart.style.setProperty('--day-count', String(days.length));
    chart.innerHTML = days.map(function (day, dayIndex) {
      var selected = entries.filter(function (entry) { return state.filter === 'All' || state.filter === entry.name; });
      var sum = selected.reduce(function (total, entry) { return total + Number(day.places[entry.name] || 0); }, 0);
      var height = Math.max(1.5, Math.min(100, sum / maximumMinutes * 100));
      var segments = selected.map(function (entry) {
        var value = Number(day.places[entry.name] || 0);
        if (!value) return '';
        return '<span class="day-segment" style="--place-color:' + entry.color + ';flex:' + value + '" data-tooltip="' + escapeHtml(entry.name) + ' · ' + minutesLabel(value) + '"></span>';
      }).join('');
      var date = new Date(day.date + 'T12:00:00');
      var label = date.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2);
      var showDate = days.length <= 14 || dayIndex % Math.ceil(days.length / 10) === 0 || dayIndex === days.length - 1;
      return '<div class="day-column"><div class="day-stack" style="height:' + height + '%" title="' + shortDate(day.date) + ' · ' + minutesLabel(sum) + '">' + segments + '</div>' + (showDate ? '<span class="day-label"><strong>' + label + '</strong>' + (days.length <= 7 ? date.getDate() : '') + '</span>' : '') + '</div>';
    }).join('');
  }

  function renderPlaces(entries) {
    var total = entries.reduce(function (sum, entry) { return sum + entry.minutes; }, 0);
    var max = entries[0] ? entries[0].minutes : 1;
    document.getElementById('place-total').textContent = minutesLabel(total) + ' total';
    document.getElementById('place-list').innerHTML = entries.map(function (entry) {
      var share = total ? Math.round(entry.minutes / total * 100) : 0;
      return '<div class="place-row" style="--place-color:' + entry.color + ';--fill:' + Math.round(entry.minutes / max * 100) + '%"><div class="place-name"><i></i><span>' + escapeHtml(entry.name) + '</span></div><div class="place-track"><div class="place-fill"></div></div><div class="place-value">' + minutesLabel(entry.minutes) + '<small>' + share + '%</small></div></div>';
    }).join('');
  }

  function renderHeatmap(days, entries) {
    var weekdayNames = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    var buckets = {};
    entries.slice(0, 4).forEach(function (entry) { buckets[entry.name] = [[], [], [], [], [], [], []]; });
    days.forEach(function (day) {
      var nativeDay = new Date(day.date + 'T12:00:00').getDay();
      var index = nativeDay === 0 ? 6 : nativeDay - 1;
      Object.keys(buckets).forEach(function (name) { buckets[name][index].push(Number(day.places[name] || 0)); });
    });
    var html = '<span class="heat-label"></span>' + weekdayNames.map(function (name) { return '<span class="heat-label">' + name + '</span>'; }).join('');
    entries.slice(0, 4).forEach(function (entry) {
      var values = buckets[entry.name].map(function (bucket) { return bucket.length ? bucket.reduce(function (sum, value) { return sum + value; }, 0) / bucket.length : 0; });
      var maximum = Math.max.apply(null, values.concat([1]));
      html += '<span class="heat-label row">' + escapeHtml(entry.name.slice(0, 4)) + '</span>';
      values.forEach(function (value, index) {
        html += '<span class="heat-cell" style="--cell-color:' + entry.color + ';--intensity:' + (.14 + value / maximum * .86).toFixed(2) + '" data-tooltip="' + escapeHtml(entry.name) + ' · ' + weekdayNames[index] + ' · ' + minutesLabel(value) + '"></span>';
      });
    });
    document.getElementById('heatmap').innerHTML = html;
    if (entries[0]) {
      var strongestDay = 0;
      var strongestValue = -1;
      for (var dayIndex = 0; dayIndex < 7; dayIndex += 1) {
        var dayValue = days.filter(function (day) {
          var nativeDay = new Date(day.date + 'T12:00:00').getDay();
          return (nativeDay === 0 ? 6 : nativeDay - 1) === dayIndex;
        }).reduce(function (sum, day) { return sum + Number(day.places[entries[0].name] || 0); }, 0);
        if (dayValue > strongestValue) { strongestValue = dayValue; strongestDay = dayIndex; }
      }
      var fullDays = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
      document.getElementById('pattern-insight').textContent = entries[0].name + ' anchors your routine, especially on ' + fullDays[strongestDay] + '. Your routine score compares this shape from day to day.';
    }
  }

  function sessionsFor(days) {
    var sessions = [];
    days.slice().reverse().some(function (day) {
      var start = 7 * 60 + (hash(day.date) % 90);
      Object.keys(day.places).sort(function (a, b) { return day.places[b] - day.places[a]; }).forEach(function (name) {
        if (sessions.length >= 6 || !day.places[name]) return;
        var duration = Math.min(Number(day.places[name]), 280);
        var from = start;
        var to = start + duration;
        sessions.push({ place: name, date: day.date, from: from, to: to, duration: duration });
        start = to + 24;
      });
      return sessions.length >= 6;
    });
    return sessions;
  }
  function clock(minutes) {
    var hours = Math.floor(minutes / 60) % 24;
    var mins = Math.floor(minutes % 60);
    var suffix = hours >= 12 ? 'pm' : 'am';
    return ((hours + 11) % 12 + 1) + ':' + pad(mins) + suffix;
  }
  function renderSessions(days) {
    var sessions = sessionsFor(days);
    document.getElementById('session-list').innerHTML = sessions.map(function (session, index) {
      var color = placeColor(session.place, index);
      var date = new Date(session.date + 'T12:00:00');
      return '<div class="session-row" role="row"><span class="session-place" role="cell" style="--place-color:' + color + '"><i></i>' + escapeHtml(session.place) + '</span><span role="cell">' + date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + '</span><span role="cell">' + clock(session.from) + ' — ' + clock(session.to) + '</span><span role="cell">' + minutesLabel(session.duration) + '</span></div>';
    }).join('');
  }

  function render() {
    var days = visibleDays();
    var entries = placeEntries(totalsFor(days));
    if (state.filter !== 'All' && !entries.some(function (entry) { return entry.name === state.filter; })) state.filter = 'All';
    renderOverview(days, entries);
    renderFilters(entries);
    renderRhythm(days, entries);
    renderPlaces(entries);
    renderHeatmap(days, entries);
    renderSessions(days);
    document.querySelectorAll('[data-days]').forEach(function (button) { button.classList.toggle('is-selected', Number(button.dataset.days) === state.days); });
    document.querySelector('.data-label').innerHTML = '<span class="live-dot"></span>' + (state.imported ? 'Imported tracker data' : 'Sample tracker data');
  }

  function normalizeData(input) {
    if (!input || !Array.isArray(input.days) || !input.days.length) throw new Error('Expected a non-empty "days" array.');
    var placeNames = [];
    var days = input.days.map(function (day) {
      if (!day.date || !day.places || typeof day.places !== 'object') throw new Error('Each day needs a date and a places object.');
      var normalizedPlaces = {};
      Object.keys(day.places).forEach(function (name) {
        var minutes = Number(day.places[name]);
        if (!Number.isFinite(minutes) || minutes < 0) throw new Error('Place minutes must be positive numbers.');
        normalizedPlaces[String(name)] = minutes;
        if (placeNames.indexOf(String(name)) === -1) placeNames.push(String(name));
      });
      return { date: String(day.date).slice(0, 10), places: normalizedPlaces };
    }).sort(function (a, b) { return a.date.localeCompare(b.date); });
    var configured = Array.isArray(input.places) ? input.places : [];
    var places = placeNames.map(function (name, index) {
      var match = configured.find(function (place) { return place && place.name === name; });
      return { name: name, color: match && /^#[0-9a-f]{6}$/i.test(match.color) ? match.color : COLORS[index % COLORS.length] };
    });
    return { places: places, days: days };
  }

  function showToast(message) {
    var toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('is-visible'); }, 3200);
  }
  function importFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        state.data = normalizeData(JSON.parse(reader.result));
        state.days = preferredRange(state.data.days.length);
        state.filter = 'All';
        state.imported = true;
        render();
        showToast('Tracker data imported. It stays in this browser.');
      } catch (error) {
        showToast('Could not import that file: ' + error.message);
      }
    };
    reader.readAsText(file);
  }
  function downloadData() {
    var blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'lifevector-data.json';
    link.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
    showToast('LifeVector data downloaded.');
  }

  document.getElementById('range-control').addEventListener('click', function (event) {
    var button = event.target.closest('[data-days]');
    if (!button) return;
    state.days = Number(button.dataset.days);
    render();
  });
  document.getElementById('place-filters').addEventListener('click', function (event) {
    var button = event.target.closest('[data-place]');
    if (!button) return;
    state.filter = button.dataset.place;
    render();
  });
  document.getElementById('import-button').addEventListener('click', function () { document.getElementById('data-file').click(); });
  document.getElementById('data-file').addEventListener('change', function (event) { importFile(event.target.files[0]); event.target.value = ''; });
  document.getElementById('sample-button').addEventListener('click', function () {
    state.data = makeSampleData(); state.days = 7; state.filter = 'All'; state.imported = false; render(); showToast('Sample tracker data restored.');
  });
  document.getElementById('download-button').addEventListener('click', downloadData);
  document.getElementById('menu-button').addEventListener('click', function () {
    var open = document.body.classList.toggle('menu-open');
    this.setAttribute('aria-expanded', String(open));
  });
  document.querySelectorAll('.nav-item').forEach(function (item) {
    item.addEventListener('click', function () {
      document.querySelectorAll('.nav-item').forEach(function (link) { link.classList.remove('is-active'); });
      item.classList.add('is-active');
      document.body.classList.remove('menu-open');
      document.getElementById('menu-button').setAttribute('aria-expanded', 'false');
    });
  });

  window.LifeVectorDashboard = {
    load: function (data) { state.data = normalizeData(data); state.days = preferredRange(state.data.days.length); state.imported = true; render(); },
    reset: function () { state.data = makeSampleData(); state.days = 7; state.filter = 'All'; state.imported = false; render(); }
  };
  render();
}());
