/* Saves research groups and survey responses in this browser. */
(function () {
  "use strict";

  var STORAGE_KEY = "student-body-measures-v1";
  var GROUP_KEY = "student-body-measures-group-v1";
  var GENDERS = ["Male", "Female", "Prefer not to say"];
  var LIMITS = {
    age: { min: 16, max: 70, label: "age" },
    height: { min: 120, max: 220, label: "height" },
    weight: { min: 30, max: 200, label: "weight" }
  };

  var groupForm = document.getElementById("group-form");
  var groupStatus = document.getElementById("group-status");
  var groupList = document.getElementById("group-list");
  var groupEmpty = document.getElementById("group-empty");
  var form = document.getElementById("survey-form");
  var recordGroupSelect = document.getElementById("record-group");
  var resultsGroupSelect = document.getElementById("results-group");
  var recorderSelect = document.getElementById("recorder");
  var statusNode = document.getElementById("status");
  var previewNode = document.getElementById("bmi-preview");
  var recordsBody = document.getElementById("records-body");
  var recordsTable = document.getElementById("records-table");
  var emptyState = document.getElementById("empty-state");
  var importButton = document.getElementById("import-button");
  var importFile = document.getElementById("import-file");
  var exportButton = document.getElementById("export-button");
  var clearButton = document.getElementById("clear-button");
  var recordCount = document.getElementById("record-count");
  var datasetCount = document.getElementById("dataset-count");
  var meanAge = document.getElementById("mean-age");
  var meanHeight = document.getElementById("mean-height");
  var meanWeight = document.getElementById("mean-weight");
  var meanBmi = document.getElementById("mean-bmi");
  var memberBars = document.getElementById("member-bars");
  var memberEmpty = document.getElementById("member-empty");

  var store = loadStore();
  var records = loadRecords();
  var clearArmed = false;
  var clearTimer = 0;
  var clearPrompt = "";

  migrateUngroupedRecords();
  ensureActive();

  groupForm.addEventListener("submit", onGroupSubmit);
  groupList.addEventListener("click", onGroupListClick);
  form.addEventListener("submit", onSubmit);
  form.addEventListener("input", onInput);
  form.addEventListener("wheel", onWheel, { passive: true });
  recordGroupSelect.addEventListener("change", onRecordGroupChange);
  resultsGroupSelect.addEventListener("change", onResultsGroupChange);
  recordsBody.addEventListener("click", onTableClick);
  importButton.addEventListener("click", function () {
    importFile.click();
  });
  importFile.addEventListener("change", onImportFile);
  exportButton.addEventListener("click", exportCsv);
  clearButton.addEventListener("click", onClear);

  updatePreview();
  render();

  function onGroupSubmit(event) {
    event.preventDefault();
    var name = document.getElementById("group-name").value.trim();
    var members = [1, 2, 3, 4].map(function (index) {
      return document.getElementById("member-" + index).value.trim();
    }).filter(Boolean);

    if (!name) {
      setGroupStatus("Enter a group name.");
      document.getElementById("group-name").focus();
      return;
    }
    if (!members.length) {
      setGroupStatus("Add at least one team member. A group can list up to four.");
      document.getElementById("member-1").focus();
      return;
    }
    if (hasDuplicate(members)) {
      setGroupStatus("Each team member needs a different name.");
      return;
    }
    if (name.length > 60 || members.some(function (member) { return member.length > 40; })) {
      setGroupStatus("Use a shorter group name or team member name.");
      return;
    }

    var existing = findGroup(name);
    var previous = existing ? existing.name : "";
    if (existing) {
      existing.name = name;
      existing.members = members;
      records.forEach(function (record) {
        if (record.group === previous) record.group = name;
      });
      saveRecords();
    } else {
      store.groups.push({ name: name, members: members });
    }
    store.active = name;
    saveStore();
    clearGroupFields();
    clearFieldError("record-group");
    clearFieldError("recorder");
    render();
    var label = members.length === 1 ? "1 team member" : members.length + " team members";
    setGroupStatus((existing ? "Updated " : "Saved ") + name + " · " + label + ".");
  }

  function onGroupListClick(event) {
    var remove = event.target.closest("[data-remove]");
    if (remove) {
      var removed = store.groups[Number(remove.getAttribute("data-remove"))];
      if (removed) removeGroup(removed.name);
      return;
    }
    var button = event.target.closest("[data-index]");
    if (!button) return;
    var selected = store.groups[Number(button.getAttribute("data-index"))];
    if (!selected) return;
    paintGroupFields(selected);
    store.active = selected.name;
    saveStore();
    render();
    setGroupStatus(selected.name + " selected.");
  }

  function onRecordGroupChange() {
    clearFieldError("record-group");
    clearFieldError("recorder");
    store.active = recordGroupSelect.value;
    ensureActive();
    saveStore();
    render();
  }

  function onResultsGroupChange() {
    store.active = resultsGroupSelect.value;
    ensureActive();
    saveStore();
    render();
  }

  function onSubmit(event) {
    event.preventDefault();
    var draft = readDraft();
    var errors = validate(draft);
    showErrors(errors);

    if (hasErrors(errors)) {
      focusFirstError(errors);
      setStatus("Check the highlighted fields.");
      return;
    }

    var record = {
      n: nextNumber(records),
      group: draft.group,
      recordedBy: draft.recorder,
      gender: draft.gender,
      age: Number(draft.age),
      height: Number(draft.height),
      weight: Number(draft.weight),
      at: new Date().toISOString()
    };

    records.push(record);
    saveRecords();
    form.reset();
    showErrors({});
    updatePreview();
    render();
    setStatus("Saved " + formatId(record.n) + " in " + record.group + " for " + record.recordedBy + ".");
  }

  function onInput(event) {
    var target = event.target;
    if (target.name === "gender") clearFieldError("gender");
    if (target.id === "record-group" || target.id === "recorder") clearFieldError(target.id);
    if (target.id && target.id !== "record-group" && target.id !== "recorder") clearFieldError(target.id);
    updatePreview();
  }

  function onWheel() {
    if (document.activeElement && document.activeElement.type === "number") {
      document.activeElement.blur();
    }
  }

  function onTableClick(event) {
    var button = event.target.closest("button[data-id]");
    if (!button) return;
    var id = Number(button.getAttribute("data-id"));
    records = records.filter(function (record) {
      return record.n !== id;
    });
    saveRecords();
    render();
    setStatus("Removed " + formatId(id) + ".");
  }

  function onClear() {
    var visible = visibleRecords();
    if (!visible.length) return;
    if (!clearArmed) {
      clearArmed = true;
      clearPrompt = "Click Confirm clear to delete every record in " + store.active + ".";
      clearButton.textContent = "Confirm clear";
      clearButton.classList.add("danger");
      window.clearTimeout(clearTimer);
      clearTimer = window.setTimeout(disarmClear, 6000);
      setStatus(clearPrompt);
      return;
    }
    var ids = {};
    visible.forEach(function (record) {
      ids[record.n] = true;
    });
    records = records.filter(function (record) {
      return !ids[record.n];
    });
    saveRecords();
    render();
    setStatus("Cleared records for " + store.active + ".");
  }

  function disarmClear() {
    var armed = clearArmed;
    var prompt = clearPrompt;
    clearArmed = false;
    clearPrompt = "";
    window.clearTimeout(clearTimer);
    clearButton.textContent = "Clear dataset";
    clearButton.classList.remove("danger");
    if (armed && statusNode.textContent === prompt) setStatus("");
  }

  function onImportFile(event) {
    var file = event.target.files && event.target.files[0];
    importFile.value = "";
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var result = importCsv(String(reader.result || ""));
      if (result.error) {
        setStatus(result.error);
        return;
      }
      render();
      var addedLabel = result.added === 1 ? "1 record" : result.added + " records";
      var skippedLabel = result.skipped === 1 ? "1 row" : result.skipped + " rows";
      setStatus("Imported " + addedLabel + ". Skipped " + skippedLabel + ".");
    };
    reader.onerror = function () {
      setStatus("Could not read that file.");
    };
    reader.readAsText(file);
  }

  function importCsv(text) {
    var rows = parseCsv(text);
    if (rows.length < 2) return { error: "That CSV has no data rows." };
    var header = rows[0].map(function (cell) {
      return cell.trim().toLowerCase();
    });
    var columns = {
      group: columnIndex(header, ["group", "group_name"]),
      gender: columnIndex(header, ["gender"]),
      age: columnIndex(header, ["age"]),
      height: columnIndex(header, ["height_cm", "height"]),
      weight: columnIndex(header, ["weight_kg", "weight"]),
      recordedBy: columnIndex(header, ["recorded_by", "recorded by", "recorder"]),
      at: columnIndex(header, ["recorded_at", "recorded", "at"])
    };
    if (columns.gender < 0 || columns.age < 0 || columns.height < 0 || columns.weight < 0) {
      return { error: "The CSV needs gender, age, height, and weight columns." };
    }
    if (columns.group < 0 && !store.active) {
      return { error: "Choose a group before importing, or use a CSV that includes a group column." };
    }

    var seen = {};
    records.forEach(function (record) {
      seen[recordKey(record)] = true;
    });

    var added = 0;
    var skipped = 0;
    var firstGroup = "";
    rows.slice(1).forEach(function (row) {
      var draft = {
        gender: cellAt(row, columns.gender),
        age: cellAt(row, columns.age),
        height: cellAt(row, columns.height),
        weight: cellAt(row, columns.weight)
      };
      if (hasErrors(validateMeasures(draft))) {
        skipped += 1;
        return;
      }
      var rawGroup = columns.group < 0 ? store.active : cellAt(row, columns.group).slice(0, 60);
      if (!rawGroup) {
        skipped += 1;
        return;
      }
      var known = findGroup(rawGroup);
      var groupName = known ? known.name : rawGroup;
      var recordedBy = columns.recordedBy < 0 ? "" : cellAt(row, columns.recordedBy).slice(0, 40);
      var at = columns.at < 0 ? "" : cellAt(row, columns.at);
      var stamped = new Date(at);
      var record = {
        n: 0,
        group: groupName,
        recordedBy: recordedBy,
        gender: draft.gender,
        age: Number(draft.age),
        height: Number(draft.height),
        weight: Number(draft.weight),
        at: isNaN(stamped.getTime()) ? new Date().toISOString() : stamped.toISOString()
      };
      var key = recordKey(record);
      if (seen[key]) {
        skipped += 1;
        return;
      }
      rememberMember(groupName, recordedBy);
      seen[key] = true;
      record.n = nextNumber(records);
      records.push(record);
      if (!firstGroup) firstGroup = groupName;
      added += 1;
    });

    if (added) {
      store.active = firstGroup;
      saveStore();
      saveRecords();
    }
    return { added: added, skipped: skipped };
  }

  function readDraft() {
    var data = new FormData(form);
    return {
      group: String(data.get("group") || ""),
      recorder: String(data.get("recorder") || ""),
      gender: String(data.get("gender") || ""),
      age: String(data.get("age") || ""),
      height: String(data.get("height") || ""),
      weight: String(data.get("weight") || "")
    };
  }

  function validate(draft) {
    var errors = validateMeasures(draft);
    var chosen = findGroup(draft.group);
    if (!chosen) errors["record-group"] = "Select a group.";
    else if (chosen.members.indexOf(draft.recorder) === -1) errors.recorder = "Select a team member from this group.";
    return errors;
  }

  function validateMeasures(draft) {
    var errors = {};
    if (GENDERS.indexOf(draft.gender) === -1) errors.gender = "Select a gender.";
    checkNumber(errors, "age", draft.age, true);
    checkNumber(errors, "height", draft.height, false);
    checkNumber(errors, "weight", draft.weight, false);
    return errors;
  }

  function checkNumber(errors, name, raw, whole) {
    var limits = LIMITS[name];
    if (String(raw).trim() === "") {
      errors[name] = "Enter " + limits.label + ".";
      return;
    }
    var value = Number(raw);
    if (!isFinite(value) || (whole && !isWhole(value))) {
      errors[name] = whole
        ? "Enter " + limits.label + " as a whole number."
        : "Enter " + limits.label + " as a number.";
      return;
    }
    if (value < limits.min || value > limits.max) {
      errors[name] = "Enter " + limits.label + " from " + limits.min + " to " + limits.max + ".";
    }
  }

  function isWhole(value) {
    return Math.abs(value - Math.round(value)) < 1e-9;
  }

  function hasErrors(errors) {
    return Object.keys(errors).length > 0;
  }

  function showErrors(errors) {
    ["record-group", "recorder", "gender", "age", "height", "weight"].forEach(function (name) {
      var message = errors[name] || "";
      document.getElementById(name + "-error").textContent = message;
      var control = name === "gender"
        ? document.getElementById("gender-field")
        : document.getElementById(name);
      if (message) control.setAttribute("aria-invalid", "true");
      else control.removeAttribute("aria-invalid");
    });
  }

  function clearFieldError(name) {
    var node = document.getElementById(name + "-error");
    if (!node) return;
    node.textContent = "";
    var control = name === "gender"
      ? document.getElementById("gender-field")
      : document.getElementById(name);
    if (control) control.removeAttribute("aria-invalid");
  }

  function focusFirstError(errors) {
    if (errors["record-group"]) {
      recordGroupSelect.focus();
      return;
    }
    if (errors.recorder) {
      recorderSelect.focus();
      return;
    }
    if (errors.gender) {
      form.querySelector('input[name="gender"]').focus();
      return;
    }
    if (errors.age) document.getElementById("age").focus();
    else if (errors.height) document.getElementById("height").focus();
    else if (errors.weight) document.getElementById("weight").focus();
  }

  function updatePreview() {
    var height = Number(document.getElementById("height").value);
    var weight = Number(document.getElementById("weight").value);
    if (!isFinite(height) || !isFinite(weight) || height <= 0 || weight <= 0) {
      previewNode.textContent = "BMI is calculated from height and weight when you save.";
      return;
    }
    var bmi = bodyMassIndex(height, weight);
    previewNode.textContent = "Preview BMI " + bmi.toFixed(1) + " · " + bmiBand(bmi);
  }

  function render() {
    disarmClear();
    ensureActive();
    var visible = visibleRecords();
    recordCount.textContent = String(visible.length);
    datasetCount.textContent = countLabel(visible.length);
    meanAge.textContent = formatAverage(average(visible, function (record) { return record.age; }));
    meanHeight.textContent = formatAverage(average(visible, function (record) { return record.height; }));
    meanWeight.textContent = formatAverage(average(visible, function (record) { return record.weight; }));
    meanBmi.textContent = formatAverage(average(visible, function (record) {
      return bodyMassIndex(record.height, record.weight);
    }));

    renderGroupList();
    fillGroupSelects();
    fillRecorder();
    renderMemberBars(visible);

    GENDERS.forEach(function (gender) {
      var count = visible.filter(function (record) {
        return record.gender === gender;
      }).length;
      var row = document.querySelector('[data-gender="' + gender + '"]');
      row.querySelector(".bar-count").textContent = String(count);
      var percent = visible.length ? (count / visible.length) * 100 : 0;
      row.querySelector(".bar-fill").style.width = percent + "%";
    });

    var hasRows = visible.length > 0;
    emptyState.hidden = hasRows;
    emptyState.textContent = store.active
      ? "No records yet for " + store.active + ". Add the first student above."
      : "No records yet. Choose a group and add the first student above.";
    recordsTable.hidden = !hasRows;
    exportButton.disabled = !hasRows;
    clearButton.disabled = !hasRows;

    recordsBody.replaceChildren();
    visible.forEach(function (record) {
      recordsBody.appendChild(buildRow(record));
    });
  }

  function renderMemberBars(visible) {
    var names = collectorNames(visible);
    var show = names.length > 0;
    memberBars.hidden = !show;
    memberEmpty.hidden = show;
    memberBars.replaceChildren();
    names.forEach(function (name) {
      var count = visible.filter(function (record) {
        return recorderLabel(record) === name;
      }).length;
      var item = document.createElement("li");
      item.appendChild(spanWithClass("bar-label", name));
      var track = document.createElement("span");
      track.className = "bar-track";
      var fill = document.createElement("span");
      fill.className = "bar-fill";
      var percent = visible.length ? (count / visible.length) * 100 : 0;
      fill.style.width = percent + "%";
      track.appendChild(fill);
      item.appendChild(track);
      item.appendChild(spanWithClass("bar-count", String(count)));
      memberBars.appendChild(item);
    });
  }

  function renderGroupList() {
    groupList.hidden = store.groups.length === 0;
    groupEmpty.hidden = store.groups.length > 0;
    groupList.replaceChildren();
    store.groups.forEach(function (group, index) {
      var item = document.createElement("li");
      item.className = "group-item";
      var button = document.createElement("button");
      button.type = "button";
      button.className = "group-row" + (group.name === store.active ? " is-active" : "");
      button.setAttribute("data-index", String(index));
      var label = document.createElement("span");
      label.textContent = group.name;
      var meta = document.createElement("small");
      meta.textContent = group.members.length === 1 ? "1 team member" : group.members.length + " team members";
      button.appendChild(label);
      button.appendChild(meta);
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "link-button";
      remove.setAttribute("data-remove", String(index));
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", "Remove " + group.name);
      item.appendChild(button);
      item.appendChild(remove);
      groupList.appendChild(item);
    });
  }

  function buildRow(record) {
    var bmi = bodyMassIndex(record.height, record.weight);
    var row = document.createElement("tr");
    row.appendChild(cell(formatId(record.n), "num"));
    row.appendChild(cell(groupLabel(record)));
    row.appendChild(cell(recorderLabel(record)));
    row.appendChild(cell(record.gender));
    row.appendChild(cell(String(record.age), "num"));
    row.appendChild(cell(formatMeasure(record.height), "num"));
    row.appendChild(cell(formatMeasure(record.weight), "num"));

    var bmiCell = document.createElement("td");
    bmiCell.className = "num";
    var value = document.createElement("span");
    value.textContent = bmi.toFixed(1);
    var band = document.createElement("span");
    band.className = "band";
    band.textContent = bmiBand(bmi);
    bmiCell.appendChild(value);
    bmiCell.appendChild(band);
    row.appendChild(bmiCell);

    row.appendChild(cell(formatWhen(record.at)));

    var action = document.createElement("td");
    var remove = document.createElement("button");
    remove.type = "button";
    remove.className = "link-button";
    remove.setAttribute("data-id", String(record.n));
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", "Remove " + formatId(record.n));
    action.appendChild(remove);
    row.appendChild(action);
    return row;
  }

  function cell(text, className) {
    var item = document.createElement("td");
    if (className) item.className = className;
    item.textContent = text;
    return item;
  }

  function spanWithClass(className, text) {
    var node = document.createElement("span");
    node.className = className;
    node.textContent = text;
    return node;
  }

  function exportCsv() {
    var visible = visibleRecords();
    if (!visible.length) return;
    var lines = ["id,group,recorded_by,gender,age,height_cm,weight_kg,bmi,recorded_at"];
    visible.forEach(function (record) {
      lines.push([
        formatId(record.n),
        csvEscape(groupLabel(record)),
        csvEscape(recorderLabel(record)),
        csvEscape(record.gender),
        record.age,
        record.height,
        record.weight,
        bodyMassIndex(record.height, record.weight).toFixed(1),
        record.at
      ].join(","));
    });
    var blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = fileSlug() + ".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus("CSV downloaded for " + store.active + ".");
  }

  function csvEscape(value) {
    var text = String(value);
    if (/[",\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function parseCsv(text) {
    var input = String(text).replace(/^\uFEFF/, "");
    var rows = [];
    var row = [];
    var cell = "";
    var quoted = false;
    for (var i = 0; i < input.length; i += 1) {
      var char = input.charAt(i);
      if (quoted) {
        if (char === '"') {
          if (input.charAt(i + 1) === '"') {
            cell += '"';
            i += 1;
          } else {
            quoted = false;
          }
        } else {
          cell += char;
        }
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === ",") {
        row.push(cell);
        cell = "";
      } else if (char === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else if (char !== "\r") cell += char;
    }
    if (cell.length || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows.filter(function (item) {
      return item.some(function (value) {
        return String(value).trim() !== "";
      });
    });
  }

  function columnIndex(header, names) {
    for (var i = 0; i < names.length; i += 1) {
      var index = header.indexOf(names[i]);
      if (index !== -1) return index;
    }
    return -1;
  }

  function cellAt(row, index) {
    if (index < 0 || index >= row.length) return "";
    return String(row[index] || "").trim();
  }

  function recordKey(record) {
    return [
      groupLabel(record),
      recorderLabel(record),
      record.gender,
      record.age,
      record.height,
      record.weight,
      record.at
    ].join("|");
  }

  function loadStore() {
    try {
      var parsed = JSON.parse(localStorage.getItem(GROUP_KEY) || "{}");
      if (Array.isArray(parsed.groups)) {
        return {
          groups: parsed.groups.map(normalizeGroup).filter(function (group) {
            return group.name;
          }),
          active: String(parsed.active || "").trim()
        };
      }
      var legacy = normalizeGroup(parsed);
      return {
        groups: legacy.name ? [legacy] : [],
        active: legacy.name || ""
      };
    } catch (error) {
      return { groups: [], active: "" };
    }
  }

  function saveStore() {
    localStorage.setItem(GROUP_KEY, JSON.stringify(store));
  }

  function normalizeGroup(value) {
    var members = Array.isArray(value && value.members) ? value.members : [];
    members = members.map(function (member) {
      return String(member || "").trim();
    }).filter(Boolean).slice(0, 4);
    return {
      name: String((value && value.name) || "").trim().slice(0, 60),
      members: uniqueNames(members)
    };
  }

  function paintGroupFields(group) {
    document.getElementById("group-name").value = group.name;
    [1, 2, 3, 4].forEach(function (index) {
      document.getElementById("member-" + index).value = group.members[index - 1] || "";
    });
  }

  function clearGroupFields() {
    groupForm.reset();
  }

  function removeGroup(name) {
    store.groups = store.groups.filter(function (group) {
      return group.name !== name;
    });
    if (store.active === name) store.active = "";
    ensureActive();
    saveStore();
    clearGroupFields();
    render();
    setGroupStatus("Removed " + name + " from the group list. Its records stay in the dataset.");
  }

  function fillGroupSelects() {
    var saved = store.groups.map(function (group) {
      return group.name;
    });
    fillSelect(recordGroupSelect, saved, saved.indexOf(store.active) === -1 ? "" : store.active, "Select a group");
    fillSelect(resultsGroupSelect, resultNames(), store.active, "");
  }

  function fillSelect(select, names, current, placeholder) {
    select.replaceChildren();
    if (!names.length) {
      var waiting = document.createElement("option");
      waiting.value = "";
      waiting.textContent = placeholder || "No groups yet";
      select.appendChild(waiting);
      select.disabled = true;
      return;
    }
    select.disabled = false;
    if (placeholder) {
      var blank = document.createElement("option");
      blank.value = "";
      blank.textContent = placeholder;
      select.appendChild(blank);
    }
    names.forEach(function (name) {
      var option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });
    if (names.indexOf(current) !== -1) select.value = current;
    else if (!placeholder) select.value = names[0];
    else select.value = "";
  }

  function fillRecorder() {
    var chosen = findGroup(store.active);
    var members = chosen ? chosen.members.slice() : [];
    var current = recorderSelect.value;
    recorderSelect.replaceChildren();
    if (!members.length) {
      var waiting = document.createElement("option");
      waiting.value = "";
      waiting.textContent = chosen ? "Add team members to this group" : "Select a group first";
      recorderSelect.appendChild(waiting);
      recorderSelect.disabled = true;
      return;
    }
    recorderSelect.disabled = false;
    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select a team member";
    recorderSelect.appendChild(placeholder);
    members.forEach(function (member) {
      var option = document.createElement("option");
      option.value = member;
      option.textContent = member;
      recorderSelect.appendChild(option);
    });
    if (members.indexOf(current) !== -1) recorderSelect.value = current;
    else if (members.length === 1) recorderSelect.value = members[0];
  }

  function loadRecords() {
    try {
      var parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isRecord);
    } catch (error) {
      return [];
    }
  }

  function saveRecords() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  function migrateUngroupedRecords() {
    if (store.groups.length !== 1) return;
    var name = store.groups[0].name;
    var changed = false;
    records.forEach(function (record) {
      if (!String(record.group || "").trim()) {
        record.group = name;
        changed = true;
      }
    });
    if (changed) saveRecords();
  }

  function isRecord(item) {
    return !!item
      && isFinite(item.n)
      && (item.group == null || typeof item.group === "string")
      && (item.recordedBy == null || typeof item.recordedBy === "string")
      && GENDERS.indexOf(item.gender) !== -1
      && isFinite(item.age)
      && isFinite(item.height)
      && isFinite(item.weight)
      && typeof item.at === "string";
  }

  function nextNumber(list) {
    return list.reduce(function (max, record) {
      return Math.max(max, Number(record.n));
    }, 0) + 1;
  }

  function visibleRecords() {
    if (!store.active) return [];
    return records.filter(function (record) {
      return groupLabel(record) === store.active;
    });
  }

  function resultNames() {
    var names = store.groups.map(function (group) {
      return group.name;
    });
    records.forEach(function (record) {
      var label = groupLabel(record);
      if (names.indexOf(label) === -1) names.push(label);
    });
    return names;
  }

  function ensureActive() {
    var names = resultNames();
    if (!names.length) {
      store.active = "";
      return;
    }
    if (names.indexOf(store.active) === -1) store.active = names[0];
  }

  function findGroup(name) {
    var key = String(name || "").trim().toLowerCase();
    if (!key) return null;
    for (var i = 0; i < store.groups.length; i += 1) {
      if (store.groups[i].name.toLowerCase() === key) return store.groups[i];
    }
    return null;
  }

  function rememberMember(groupName, member) {
    var group = findGroup(groupName);
    if (!group) {
      group = { name: groupName, members: [] };
      store.groups.push(group);
    }
    var clean = String(member || "").trim();
    if (!clean || clean === "Not named") return;
    if (group.members.indexOf(clean) === -1 && group.members.length < 4) group.members.push(clean);
  }

  function collectorNames(visible) {
    var group = findGroup(store.active);
    var names = group ? group.members.slice() : [];
    visible.forEach(function (record) {
      var label = recorderLabel(record);
      if (names.indexOf(label) === -1) names.push(label);
    });
    return names;
  }

  function groupLabel(record) {
    var name = String(record.group || "").trim();
    return name || "Not named";
  }

  function recorderLabel(record) {
    var name = String(record.recordedBy || "").trim();
    return name || "Not named";
  }

  function countLabel(length) {
    var text = length === 1 ? "1 record" : length + " records";
    if (store.active) text += " · " + store.active;
    return text;
  }

  function hasDuplicate(names) {
    return uniqueNames(names).length !== names.length;
  }

  function uniqueNames(names) {
    var seen = {};
    return names.filter(function (name) {
      var key = name.toLowerCase();
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function fileSlug() {
    var base = (store.active || "haseeb-student-health-survey").toLowerCase();
    base = base.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return base || "haseeb-student-health-survey";
  }

  function bodyMassIndex(heightCm, weightKg) {
    var metres = heightCm / 100;
    return weightKg / (metres * metres);
  }

  function bmiBand(value) {
    if (value < 18.5) return "Underweight";
    if (value < 25) return "Healthy range";
    if (value < 30) return "Overweight";
    return "Obese";
  }

  function average(list, pick) {
    if (!list.length) return null;
    var total = list.reduce(function (sum, record) {
      return sum + pick(record);
    }, 0);
    return total / list.length;
  }

  function formatAverage(value) {
    if (value == null) return "\u2014";
    return value.toLocaleString("en-GB", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    });
  }

  function formatMeasure(value) {
    return Number(value).toLocaleString("en-GB", { maximumFractionDigits: 1 });
  }

  function formatId(n) {
    return "S-" + String(n).padStart(3, "0");
  }

  function formatWhen(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return iso;
    return date.toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function setStatus(message) {
    statusNode.textContent = message;
  }

  function setGroupStatus(message) {
    groupStatus.textContent = message;
  }
})();
