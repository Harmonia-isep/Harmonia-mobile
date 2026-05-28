import json
from pathlib import Path

from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QScrollArea, QFrame, QInputDialog, QMessageBox,
    QDialog, QListWidget, QListWidgetItem, QDialogButtonBox
)
from PySide6.QtCore import Qt

from ui import theme

_PLAYLISTS_FILE = Path(__file__).parent.parent / "playlists.json"


def _load_playlists() -> list:
    if _PLAYLISTS_FILE.exists():
        try:
            return json.loads(_PLAYLISTS_FILE.read_text(encoding="utf-8")).get("playlists", [])
        except Exception:
            pass
    return []


def _save_playlists(playlists: list):
    _PLAYLISTS_FILE.write_text(
        json.dumps({"playlists": playlists}, indent=2), encoding="utf-8"
    )


def _next_id(playlists: list) -> int:
    return max((p["id"] for p in playlists), default=0) + 1


class PlaylistScreen(QWidget):
    def __init__(self, on_back):
        super().__init__()
        self.on_back             = on_back
        self._playlists          = []
        self._library_tracks     = []
        self._current_playlist   = None
        self._setup_ui()

    def refresh(self, library_tracks: list):
        self._library_tracks = library_tracks
        self._playlists      = _load_playlists()
        self._current_playlist = None
        self._show_list()

    # ── UI shell ───────────────────────────────────────────────────────────

    def _setup_ui(self):
        self.setObjectName("PlaylistScreen")
        self.setStyleSheet(f"#PlaylistScreen {{ background: {theme.BG_PRIMARY}; }}")

        self._root = QVBoxLayout(self)
        self._root.setContentsMargins(14, 14, 14, 10)
        self._root.setSpacing(6)

        hdr = QHBoxLayout()
        self._back_btn = QPushButton("← Library")
        self._back_btn.setStyleSheet(f"""
            QPushButton {{ background: transparent; color: {theme.ACCENT};
                border: none; font-size: 13px; padding: 0; }}
            QPushButton:hover {{ color: {theme.ACCENT_HOVER}; }}
        """)
        self._back_btn.clicked.connect(self._handle_back)
        hdr.addWidget(self._back_btn)
        hdr.addStretch()
        self._action_btn = self._mk_btn("+", theme.ACCENT, self._primary_action, "New playlist")
        hdr.addWidget(self._action_btn)
        self._root.addLayout(hdr)

        self._title_lbl = QLabel("Playlists")
        self._title_lbl.setStyleSheet(
            f"color: {theme.TEXT_PRIMARY}; font-size: 20px; font-weight: bold;"
        )
        self._root.addWidget(self._title_lbl)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        scroll.setStyleSheet(f"QScrollArea {{ border: none; background: {theme.BG_PRIMARY}; }}")
        scroll.viewport().setStyleSheet(f"background: {theme.BG_PRIMARY};")

        self._content_w = QWidget()
        self._content_w.setStyleSheet(f"background: {theme.BG_PRIMARY};")
        self._content_l = QVBoxLayout(self._content_w)
        self._content_l.setSpacing(4)
        self._content_l.setContentsMargins(0, 0, 4, 0)
        scroll.setWidget(self._content_w)
        self._root.addWidget(scroll)

    def _mk_btn(self, text, color, slot, tip):
        btn = QPushButton(text)
        btn.setFixedSize(34, 34)
        btn.setToolTip(tip)
        btn.setStyleSheet(f"""
            QPushButton {{
                background: {theme.BG_SECONDARY}; color: {color};
                border: 1px solid {color}; border-radius: {theme.RADIUS_SM}px;
                font-size: 17px; font-weight: bold;
            }}
            QPushButton:hover {{ background: {color}; color: {theme.BG_PRIMARY}; }}
        """)
        btn.clicked.connect(slot)
        return btn

    def _clear_content(self):
        while self._content_l.count():
            item = self._content_l.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

    def _handle_back(self):
        if self._current_playlist:
            self._current_playlist = None
            self._show_list()
        else:
            self.on_back()

    def _primary_action(self):
        if self._current_playlist:
            self._add_track_to_playlist()
        else:
            self._create_playlist()

    # ── List view ──────────────────────────────────────────────────────────

    def _show_list(self):
        self._title_lbl.setText("Playlists")
        self._action_btn.setToolTip("New playlist")
        self._clear_content()

        if not self._playlists:
            lbl = QLabel("No playlists yet — press + to create one")
            lbl.setAlignment(Qt.AlignCenter)
            lbl.setStyleSheet(
                f"color: {theme.TEXT_TERTIARY}; font-size: 13px; padding: 20px;"
            )
            self._content_l.addWidget(lbl)
        else:
            for pl in self._playlists:
                self._content_l.addWidget(self._make_playlist_card(pl))
        self._content_l.addStretch()

    def _make_playlist_card(self, pl: dict) -> QFrame:
        card = QFrame()
        card.setFrameShape(QFrame.NoFrame)
        card.setFixedHeight(56)
        card.setCursor(Qt.PointingHandCursor)
        card.setStyleSheet(f"""
            QFrame {{ background: {theme.BG_SECONDARY}; border-radius: {theme.RADIUS_SM}px; }}
            QFrame:hover {{ background: {theme.BG_TERTIARY}; }}
        """)
        row = QHBoxLayout(card)
        row.setContentsMargins(12, 0, 6, 0)
        row.setSpacing(8)

        icon = QLabel("≡")
        icon.setFixedWidth(22)
        icon.setStyleSheet(f"color: {theme.ACCENT}; font-size: 18px;")
        row.addWidget(icon)

        info = QVBoxLayout()
        info.setSpacing(1)
        name_lbl = QLabel(pl["name"])
        name_lbl.setStyleSheet(
            f"color: {theme.TEXT_PRIMARY}; font-weight: bold; font-size: 13px;"
        )
        n = len(pl.get("tracks", []))
        count_lbl = QLabel(f"{n} track{'s' if n != 1 else ''}")
        count_lbl.setStyleSheet(f"color: {theme.TEXT_SECONDARY}; font-size: 11px;")
        info.addWidget(name_lbl)
        info.addWidget(count_lbl)
        row.addLayout(info, stretch=1)

        del_btn = QPushButton("✕")
        del_btn.setFixedSize(24, 24)
        del_btn.setStyleSheet(f"""
            QPushButton {{ background: transparent; color: {theme.TEXT_TERTIARY};
                border: none; font-size: 12px; border-radius: 4px; }}
            QPushButton:hover {{ color: {theme.ERROR}; background: rgba(255,69,58,25); }}
        """)
        pl_id = pl["id"]
        del_btn.clicked.connect(lambda: self._delete_playlist(pl_id))
        row.addWidget(del_btn)

        card.mousePressEvent = lambda e: self._open_playlist(pl_id)
        return card

    def _create_playlist(self):
        name, ok = QInputDialog.getText(self, "New Playlist", "Playlist name:")
        if not ok or not name.strip():
            return
        name = name.strip()
        if any(p["name"].lower() == name.lower() for p in self._playlists):
            QMessageBox.warning(self, "Name Taken",
                                f'A playlist named "{name}" already exists.')
            return
        self._playlists.append({"id": _next_id(self._playlists), "name": name, "tracks": []})
        _save_playlists(self._playlists)
        self._show_list()

    def _delete_playlist(self, pl_id: int):
        if QMessageBox.question(
            self, "Delete Playlist", "Delete this playlist?\nTracks remain in the library.",
            QMessageBox.Yes | QMessageBox.No, QMessageBox.No
        ) != QMessageBox.Yes:
            return
        self._playlists = [p for p in self._playlists if p["id"] != pl_id]
        _save_playlists(self._playlists)
        self._show_list()

    def _open_playlist(self, pl_id: int):
        pl = next((p for p in self._playlists if p["id"] == pl_id), None)
        if not pl:
            return
        self._current_playlist = pl
        self._show_detail(pl)

    # ── Detail view ────────────────────────────────────────────────────────

    def _show_detail(self, pl: dict):
        self._title_lbl.setText(pl["name"])
        self._action_btn.setToolTip("Add track")
        self._render_playlist_tracks(pl)

    def _render_playlist_tracks(self, pl: dict):
        self._clear_content()
        track_ids = pl.get("tracks", [])
        by_id = {t["id"]: t for t in self._library_tracks}
        tracks_in_pl = [by_id[tid] for tid in track_ids if tid in by_id]

        if not tracks_in_pl:
            lbl = QLabel("No tracks — press + to add from your library")
            lbl.setAlignment(Qt.AlignCenter)
            lbl.setStyleSheet(
                f"color: {theme.TEXT_TERTIARY}; font-size: 13px; padding: 20px;"
            )
            self._content_l.addWidget(lbl)
        else:
            for idx, track in enumerate(tracks_in_pl):
                self._content_l.addWidget(
                    self._make_track_row(track, idx, len(tracks_in_pl))
                )
        self._content_l.addStretch()

    def _make_track_row(self, track: dict, idx: int, total: int) -> QFrame:
        frame = QFrame()
        frame.setFrameShape(QFrame.NoFrame)
        frame.setFixedHeight(50)
        frame.setStyleSheet(
            f"QFrame {{ background: {theme.BG_SECONDARY}; border-radius: {theme.RADIUS_SM}px; }}"
        )
        row = QHBoxLayout(frame)
        row.setContentsMargins(10, 0, 6, 0)
        row.setSpacing(6)

        num = QLabel(str(idx + 1))
        num.setFixedWidth(18)
        num.setStyleSheet(f"color: {theme.TEXT_TERTIARY}; font-size: 11px;")
        row.addWidget(num)

        name_lbl = QLabel(track["title"])
        name_lbl.setStyleSheet(
            f"color: {theme.TEXT_PRIMARY}; font-size: 13px; font-weight: bold;"
        )
        row.addWidget(name_lbl, stretch=1)

        bpm_lbl = QLabel(str(track.get("bpm", "—")))
        bpm_lbl.setStyleSheet(f"color: {theme.INFO}; font-size: 11px;")
        row.addWidget(bpm_lbl)

        tid = track["id"]
        if idx > 0:
            row.addWidget(self._mini_btn("↑", lambda _=None, t=tid: self._move_track(t, -1)))
        if idx < total - 1:
            row.addWidget(self._mini_btn("↓", lambda _=None, t=tid: self._move_track(t, 1)))

        rm = QPushButton("✕")
        rm.setFixedSize(22, 22)
        rm.setStyleSheet(f"""
            QPushButton {{ background: transparent; color: {theme.TEXT_TERTIARY};
                border: none; font-size: 11px; border-radius: 4px; }}
            QPushButton:hover {{ color: {theme.ERROR}; background: rgba(255,69,58,25); }}
        """)
        rm.clicked.connect(lambda _=None, t=tid: self._remove_from_playlist(t))
        row.addWidget(rm)
        return frame

    def _mini_btn(self, text: str, slot) -> QPushButton:
        btn = QPushButton(text)
        btn.setFixedSize(22, 22)
        btn.setStyleSheet(f"""
            QPushButton {{ background: {theme.BG_ELEVATED}; color: {theme.TEXT_SECONDARY};
                border: none; font-size: 11px; border-radius: 4px; }}
            QPushButton:hover {{ background: {theme.ACCENT}; color: {theme.BG_PRIMARY}; }}
        """)
        btn.clicked.connect(slot)
        return btn

    def _add_track_to_playlist(self):
        if not self._current_playlist:
            return
        current_ids = set(self._current_playlist.get("tracks", []))
        available   = [t for t in self._library_tracks if t["id"] not in current_ids]
        if not available:
            QMessageBox.information(self, "All added",
                                    "All library tracks are already in this playlist.")
            return

        dialog = QDialog(self)
        dialog.setWindowTitle("Add Track")
        dialog.setStyleSheet(f"background: {theme.BG_SECONDARY}; color: {theme.TEXT_PRIMARY};")
        dl = QVBoxLayout(dialog)
        dl.setContentsMargins(16, 16, 16, 16)

        lw = QListWidget()
        lw.setStyleSheet(f"""
            QListWidget {{ background: {theme.BG_SECONDARY}; color: {theme.TEXT_PRIMARY}; border: none; }}
            QListWidget::item:selected {{ background: {theme.ACCENT}; color: {theme.BG_PRIMARY}; }}
        """)
        for t in available:
            item = QListWidgetItem(f"{t['title']} — {t['artist']}")
            item.setData(Qt.UserRole, t["id"])
            lw.addItem(item)
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
        track_id = sel.data(Qt.UserRole)
        if track_id not in self._current_playlist["tracks"]:
            self._current_playlist["tracks"].append(track_id)
            _save_playlists(self._playlists)
            self._render_playlist_tracks(self._current_playlist)

    def _move_track(self, track_id: int, direction: int):
        if not self._current_playlist:
            return
        tracks = self._current_playlist["tracks"]
        if track_id not in tracks:
            return
        idx     = tracks.index(track_id)
        new_idx = idx + direction
        if 0 <= new_idx < len(tracks):
            tracks[idx], tracks[new_idx] = tracks[new_idx], tracks[idx]
            _save_playlists(self._playlists)
            self._render_playlist_tracks(self._current_playlist)

    def _remove_from_playlist(self, track_id: int):
        if not self._current_playlist:
            return
        self._current_playlist["tracks"] = [
            tid for tid in self._current_playlist["tracks"] if tid != track_id
        ]
        _save_playlists(self._playlists)
        self._render_playlist_tracks(self._current_playlist)
