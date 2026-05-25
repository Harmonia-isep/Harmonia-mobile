from PySide6.QtWidgets import QMainWindow, QStackedWidget, QLabel, QWidget
from PySide6.QtCore import Qt, QTimer, QPropertyAnimation, QEasingCurve, QPoint
from PySide6.QtGui import QFont

from ui.library_screen import LibraryScreen
from ui.track_detail_screen import TrackDetailScreen


# ── Toast notification ─────────────────────────────────────────────────────

class Toast(QLabel):
    """
    A small overlay banner that slides in at the bottom of the window,
    stays for `duration_ms` milliseconds, then fades out and hides itself.
    """

    def __init__(self, parent: QWidget):
        super().__init__(parent)
        self.setAlignment(Qt.AlignCenter)
        self.setWordWrap(True)
        self.setFont(QFont("Segoe UI", 10))
        self.setStyleSheet("""
            QLabel {
                color: #d4f1e4;
                background: #0d3d26;
                border: 1px solid #34d399;
                border-radius: 12px;
                padding: 10px 20px;
            }
        """)
        self.hide()

    def show_message(self, message: str, duration_ms: int = 3500):
        self.setText(message)
        self._reposition()
        self.show()
        self.raise_()

        # Auto-hide after duration
        QTimer.singleShot(duration_ms, self.hide)

    def _reposition(self):
        """Centre horizontally, sit 24 px above the bottom of the parent."""
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
        self.setStyleSheet("background-color: #13131f;")

        # Central stacked widget
        self.stack = QStackedWidget()
        self.setCentralWidget(self.stack)

        # Screens
        self.library = LibraryScreen(on_track_select=self.show_detail)
        self.detail  = TrackDetailScreen(on_back=self.show_library)

        self.stack.addWidget(self.library)   # index 0
        self.stack.addWidget(self.detail)    # index 1

        # Toast (lives above the stack, parented to the main widget)
        self._toast = Toast(self.centralWidget())

        # Wire up the connected signal → show toast
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