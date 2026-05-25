import sys
from PySide6.QtWidgets import QApplication
from PySide6.QtGui import QFont, QFontDatabase
from ui.main_window import MainWindow

if __name__ == "__main__":
    app = QApplication(sys.argv)
    font_name = "Inter" if "Inter" in QFontDatabase.families() else "Segoe UI"
    app.setFont(QFont(font_name, 10))
    window = MainWindow()
    window.show()
    sys.exit(app.exec())
