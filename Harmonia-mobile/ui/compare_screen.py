import random

from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QDialog, QListWidget, QListWidgetItem, QDialogButtonBox
)
from PySide6.QtGui import QPainter, QColor, QLinearGradient
from PySide6.QtCore import Qt

from ui import theme


# ── Shared FFT painter ─────────────────────────────────────────────────────

class _SpectrumWidget(QWidget):
    def __init__(self, color_hex: str):
        super().__init__()
        self.setFixedHeight(64)
        self._seed  = 1
        self._color = color_hex
        self._mags  = None

    def set_track(self, track: dict):
        self._seed = track.get("id", 1) if track else 1
        self._mags = None
        self.update()

    def set_magnitudes(self, mags: list):
        self._mags = mags
        self.update()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        w, h  = self.width(), self.height()
        bars  = 48
        bar_w = w / bars

        if self._mags:
            step = max(1, len(self._mags) // bars)
            raw  = [self._mags[i * step] for i in range(bars)]
            mx   = max(raw) if max(raw) > 0 else 1
            normalized = [a / mx for a in raw]
        else:
            random.seed(self._seed + 500)
            normalized = [
                random.uniform(0.05, 1.0) * max(0.05, 1.0 - abs(i / bars - 0.3) * 1.2)
                for i in range(bars)
            ]

        color = QColor(self._color)
        for i, amp in enumerate(normalized):
            bar_h = max(3, int(amp * (h - 4)))
            x     = int(i * bar_w)
            bw    = max(1, int(bar_w) - 1)
            grad  = QLinearGradient(x, h - bar_h, x, h)
            grad.setColorAt(0, color)
            grad.setColorAt(1, color.darker(250))
            painter.setBrush(grad)
            painter.setPen(Qt.NoPen)
            painter.drawRoundedRect(x, h - bar_h, bw, bar_h, 2, 2)


# ── Compare screen ─────────────────────────────────────────────────────────

class CompareScreen(QWidget):
    def __init__(self, on_back, get_library_tracks):
        super().__init__()
        self.on_back            = on_back
        self.get_library_tracks = get_library_tracks
        self._track_a           = None
        self._track_b           = None
        self._setup_ui()

    def set_track_a(self, track: dict):
        self._track_a = track
        self._track_b = None
        self._refresh()

    # ── UI ─────────────────────────────────────────────────────────────────

    def _setup_ui(self):
        self.setObjectName("CompareScreen")
        self.setStyleSheet(f"#CompareScreen {{ background: {theme.BG_PRIMARY}; }}")

        root = QVBoxLayout(self)
        root.setContentsMargins(14, 14, 14, 14)
        root.setSpacing(10)

        back_btn = QPushButton("← Back")
        back_btn.setStyleSheet(f"""
            QPushButton {{ background: transparent; color: {theme.ACCENT};
                border: none; font-size: 13px; text-align: left; padding: 0; }}
            QPushButton:hover {{ color: {theme.ACCENT_HOVER}; }}
        """)
        back_btn.clicked.connect(self.on_back)
        root.addWidget(back_btn)

        title = QLabel("Compare Tracks")
        title.setStyleSheet(
            f"color: {theme.TEXT_PRIMARY}; font-size: 20px; font-weight: bold;"
        )
        root.addWidget(title)

        # Track A section
        a_lbl = QLabel("Track A")
        a_lbl.setStyleSheet(f"color: {theme.ACCENT}; font-size: 11px; font-weight: bold;")
        root.addWidget(a_lbl)

        self._a_name = QLabel("—")
        self._a_name.setStyleSheet(
            f"color: {theme.TEXT_PRIMARY}; font-size: 14px; font-weight: bold;"
        )
        self._a_name.setWordWrap(True)
        root.addWidget(self._a_name)

        a_spec_lbl = QLabel("Frequency Spectrum")
        a_spec_lbl.setStyleSheet(f"color: {theme.TEXT_TERTIARY}; font-size: 10px;")
        root.addWidget(a_spec_lbl)
        self._spec_a = _SpectrumWidget(theme.ACCENT)
        root.addWidget(self._spec_a)

        # Similarity badge
        self._sim_lbl = QLabel("")
        self._sim_lbl.setAlignment(Qt.AlignCenter)
        self._sim_lbl.setStyleSheet(f"color: {theme.TEXT_TERTIARY}; font-size: 12px;")
        root.addWidget(self._sim_lbl)

        # Stats comparison
        self._stats_row = QWidget()
        self._stats_row.hide()
        sr = QHBoxLayout(self._stats_row)
        sr.setSpacing(6)
        self._bpm_a_val, bpm_a_box = self._stat_box("—", "BPM (A)", theme.ACCENT)
        self._bpm_b_val, bpm_b_box = self._stat_box("—", "BPM (B)", theme.INFO)
        self._key_a_val, key_a_box = self._stat_box("—", "Key (A)", theme.ACCENT)
        self._key_b_val, key_b_box = self._stat_box("—", "Key (B)", theme.INFO)
        for box in (bpm_a_box, bpm_b_box, key_a_box, key_b_box):
            sr.addWidget(box)
        root.addWidget(self._stats_row)

        # Track B section (hidden until selected)
        self._b_section = QWidget()
        self._b_section.hide()
        b_layout = QVBoxLayout(self._b_section)
        b_layout.setContentsMargins(0, 0, 0, 0)
        b_layout.setSpacing(4)

        b_lbl = QLabel("Track B")
        b_lbl.setStyleSheet(f"color: {theme.INFO}; font-size: 11px; font-weight: bold;")
        b_layout.addWidget(b_lbl)

        self._b_name = QLabel("—")
        self._b_name.setStyleSheet(
            f"color: {theme.TEXT_PRIMARY}; font-size: 14px; font-weight: bold;"
        )
        self._b_name.setWordWrap(True)
        b_layout.addWidget(self._b_name)

        b_spec_lbl = QLabel("Frequency Spectrum")
        b_spec_lbl.setStyleSheet(f"color: {theme.TEXT_TERTIARY}; font-size: 10px;")
        b_layout.addWidget(b_spec_lbl)
        self._spec_b = _SpectrumWidget(theme.INFO)
        b_layout.addWidget(self._spec_b)
        root.addWidget(self._b_section)

        # Select B button
        self._select_b_btn = QPushButton("Select Track B to compare →")
        self._select_b_btn.setFixedHeight(40)
        self._select_b_btn.setStyleSheet(f"""
            QPushButton {{
                background: rgba(100,210,255,18); color: {theme.INFO};
                border: 1px solid {theme.INFO}; border-radius: {theme.RADIUS_MD}px;
                font-size: 13px;
            }}
            QPushButton:hover {{ background: {theme.INFO}; color: {theme.BG_PRIMARY}; }}
        """)
        self._select_b_btn.clicked.connect(self._pick_track_b)
        root.addWidget(self._select_b_btn)

        root.addStretch()

    def _stat_box(self, value: str, label: str, color: str):
        box = QWidget()
        box.setStyleSheet(
            f"background: {theme.BG_SECONDARY}; border-radius: {theme.RADIUS_SM}px;"
        )
        bl = QVBoxLayout(box)
        bl.setContentsMargins(8, 6, 8, 6)
        bl.setSpacing(1)
        val_lbl = QLabel(value)
        val_lbl.setStyleSheet(f"color: {color}; font-size: 15px; font-weight: bold;")
        val_lbl.setAlignment(Qt.AlignCenter)
        key_lbl = QLabel(label)
        key_lbl.setStyleSheet(f"color: {theme.TEXT_TERTIARY}; font-size: 9px;")
        key_lbl.setAlignment(Qt.AlignCenter)
        bl.addWidget(val_lbl)
        bl.addWidget(key_lbl)
        return val_lbl, box

    # ── Refresh ────────────────────────────────────────────────────────────

    def _refresh(self):
        a = self._track_a
        b = self._track_b

        if a:
            self._a_name.setText(f"{a['title']} — {a['artist']}")
            self._spec_a.set_track(a)

        if b:
            self._b_name.setText(f"{b['title']} — {b['artist']}")
            self._spec_b.set_track(b)
            self._b_section.show()
            self._stats_row.show()
            self._select_b_btn.setText("Change Track B →")
            self._update_similarity(a, b)
        else:
            self._b_section.hide()
            self._stats_row.hide()
            self._sim_lbl.setText("Select Track B to see comparison")
            self._sim_lbl.setStyleSheet(f"color: {theme.TEXT_TERTIARY}; font-size: 12px;")

    def _update_similarity(self, a: dict, b: dict):
        bpm_a = a.get("bpm")
        bpm_b = b.get("bpm")
        key_a = a.get("key", "—")
        key_b = b.get("key", "—")

        self._bpm_a_val.setText(str(bpm_a) if bpm_a else "—")
        self._bpm_b_val.setText(str(bpm_b) if bpm_b else "—")
        self._key_a_val.setText(key_a)
        self._key_b_val.setText(key_b)

        notes = []
        if isinstance(bpm_a, int) and isinstance(bpm_b, int):
            diff = abs(bpm_a - bpm_b)
            if diff == 0:
                notes.append("Identical BPM")
            elif diff <= 5:
                notes.append(f"BPM within ±{diff}")

        root_a = str(key_a).split()[0].lower() if key_a != "—" else ""
        root_b = str(key_b).split()[0].lower() if key_b != "—" else ""
        if key_a == key_b and key_a != "—":
            notes.append("Same key — perfect mix!")
        elif root_a and root_b and root_a == root_b:
            notes.append("Compatible key (same root)")

        if notes:
            self._sim_lbl.setText("✓ " + "  ·  ".join(notes))
            self._sim_lbl.setStyleSheet(
                f"color: {theme.SUCCESS}; font-size: 12px; font-weight: bold;"
            )
        else:
            self._sim_lbl.setText("Different BPM and key")
            self._sim_lbl.setStyleSheet(f"color: {theme.TEXT_TERTIARY}; font-size: 12px;")

    # ── Pick track B ───────────────────────────────────────────────────────

    def _pick_track_b(self):
        tracks    = self.get_library_tracks()
        a_id      = self._track_a.get("id") if self._track_a else None
        available = [t for t in tracks if t.get("id") != a_id]

        if not available:
            return

        dialog = QDialog(self)
        dialog.setWindowTitle("Select Track B")
        dialog.setStyleSheet(
            f"background: {theme.BG_SECONDARY}; color: {theme.TEXT_PRIMARY};"
        )
        dl = QVBoxLayout(dialog)
        dl.setContentsMargins(16, 16, 16, 16)

        lw = QListWidget()
        lw.setStyleSheet(f"""
            QListWidget {{ background: {theme.BG_SECONDARY}; color: {theme.TEXT_PRIMARY};
                border: none; }}
            QListWidget::item:selected {{ background: {theme.ACCENT};
                color: {theme.BG_PRIMARY}; }}
        """)
        for t in available:
            item = QListWidgetItem(f"{t['title']} — {t['artist']}")
            item.setData(Qt.UserRole, t)
            lw.addItem(item)
        lw.setCurrentRow(0)
        dl.addWidget(lw)

        btns = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        btns.setStyleSheet(f"color: {theme.TEXT_PRIMARY};")
        btns.accepted.connect(dialog.accept)
        btns.rejected.connect(dialog.reject)
        dl.addWidget(btns)

        if dialog.exec() != QDialog.Accepted:
            return
        sel = lw.currentItem()
        if not sel:
            return
        self._track_b = sel.data(Qt.UserRole)
        self._refresh()

        # Warn if same track twice
        if self._track_b and self._track_a and self._track_b.get("id") == self._track_a.get("id"):
            from PySide6.QtWidgets import QMessageBox
            QMessageBox.warning(self, "Same Track",
                                "You selected the same track twice. Please choose a different one.")
            self._track_b = None
            self._refresh()
