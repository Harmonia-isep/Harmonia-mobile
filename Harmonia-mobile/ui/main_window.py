from PySide6.QtWidgets import QMainWindow, QStackedWidget, QLabel, QWidget
from PySide6.QtCore import Qt, QTimer

from ui.library_screen import LibraryScreen
from ui.track_detail_screen import TrackDetailScreen
from ui import theme


# ── Toast notification ─────────────────────────────────────────────────────

class Toast(QLabel):
    """
    Small overlay banner that slides in at the bottom of the window,
    stays for `duration_ms` milliseconds, then hides itself.
    """

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

        self.library = LibraryScreen(on_track_select=self.show_detail)
        self.detail  = TrackDetailScreen(on_back=self.show_library)

        self.stack.addWidget(self.library)   # index 0
        self.stack.addWidget(self.detail)    # index 1

        self._toast = Toast(self.centralWidget())
        self.library.connected.connect(self._on_connected)

    # ── Navigation ─────────────────────────────────────────────────────────

    def show_detail(self, track: dict):
        self.detail.load_track(track)
        self.stack.setCurrentIndex(1)

    def show_library(self):
        self.stack.setCurrentIndex(0)

    # ── Toast ───────────────────────────────────────────────────────────────

    def _on_connected(self, message: str):
        self._toast.show_message(f"🟢  {message}")
