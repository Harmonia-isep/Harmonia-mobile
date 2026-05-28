from PySide6.QtWidgets import QMainWindow, QStackedWidget, QLabel, QWidget
from PySide6.QtCore import Qt, QTimer

from ui.library_screen import LibraryScreen
from ui.track_detail_screen import TrackDetailScreen
from ui.playlist_screen import PlaylistScreen
from ui.compare_screen import CompareScreen
from ui import theme


# ── Toast notification ─────────────────────────────────────────────────────

class Toast(QLabel):
    def __init__(self, parent: QWidget):
        super().__init__(parent)
        self.setAlignment(Qt.AlignCenter)
        self.setWordWrap(True)
        self.setStyleSheet(f"""
            QLabel {{
                color: {theme.TEXT_PRIMARY};
                background: rgba(50, 215, 75, 18);
                border: 1px solid {theme.SUCCESS};
                border-radius: {theme.RADIUS_MD}px;
                padding: 10px 20px;
                font-size: 13px;
            }}
        """)
        self.hide()

    def show_message(self, message: str, duration_ms: int = 3500):
        self.setText(message)
        self._reposition()
        self.show()
        self.raise_()
        QTimer.singleShot(duration_ms, self.hide)

    def _reposition(self):
        if not self.parent():
            return
        parent_w = self.parent().width()
        parent_h = self.parent().height()
        w = min(parent_w - 32, 340)
        self.setFixedWidth(w)
        self.adjustSize()
        x = (parent_w - w) // 2
        y = parent_h - self.height() - 24
        self.move(x, y)


# ── Main window ────────────────────────────────────────────────────────────

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Harmonia")
        self.setFixedSize(390, 760)
        self.setStyleSheet(f"""
            QMainWindow {{
                background-color: {theme.BG_PRIMARY};
            }}
            QScrollBar:vertical {{
                width: 6px;
                background: transparent;
                border: none;
            }}
            QScrollBar::handle:vertical {{
                background: {theme.TEXT_TERTIARY};
                border-radius: 3px;
                min-height: 20px;
            }}
            QScrollBar::handle:vertical:hover {{
                background: {theme.TEXT_SECONDARY};
            }}
            QScrollBar::add-line:vertical,
            QScrollBar::sub-line:vertical {{
                height: 0;
            }}
        """)

        self.stack = QStackedWidget()
        self.setCentralWidget(self.stack)

        self.library  = LibraryScreen(on_track_select=self.show_detail)
        self.detail   = TrackDetailScreen(on_back=self.show_library)
        self.playlists = PlaylistScreen(on_back=self.show_library)
        self.compare  = CompareScreen(
            on_back=lambda: self.stack.setCurrentIndex(1),
            get_library_tracks=lambda: self.library.all_tracks,
        )

        self.stack.addWidget(self.library)    # 0
        self.stack.addWidget(self.detail)     # 1
        self.stack.addWidget(self.playlists)  # 2
        self.stack.addWidget(self.compare)    # 3

        self._toast = Toast(self.centralWidget())

        # Signals
        self.library.connected.connect(self._on_connected)
        self.library.playlists_requested.connect(self.show_playlists)
        self.detail.delete_requested.connect(self._on_detail_delete)
        self.detail.compare_requested.connect(self.show_compare)

    # ── Navigation ─────────────────────────────────────────────────────────

    def show_detail(self, track: dict):
        self.detail.set_library_tracks(self.library.all_tracks)
        self.detail.load_track(track)
        self.stack.setCurrentIndex(1)

    def show_library(self):
        self.stack.setCurrentIndex(0)

    def show_playlists(self):
        self.playlists.refresh(self.library.all_tracks)
        self.stack.setCurrentIndex(2)

    def show_compare(self, track: dict):
        self.compare.set_track_a(track)
        self.stack.setCurrentIndex(3)

    # ── Handlers ───────────────────────────────────────────────────────────

    def _on_detail_delete(self, track_id: int):
        self.library.delete_by_id(track_id)
        self.show_library()

    def _on_connected(self, message: str):
        self._toast.show_message(f"🟢  {message}")
