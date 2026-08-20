package lock

import (
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/sys/unix"
)

type File struct{ file *os.File }

func Acquire(path string, nonblocking bool) (*File, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return nil, fmt.Errorf("create lock directory: %w", err)
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o640)
	if err != nil {
		return nil, fmt.Errorf("open operation lock: %w", err)
	}
	flags := unix.LOCK_EX
	if nonblocking {
		flags |= unix.LOCK_NB
	}
	if err := unix.Flock(int(file.Fd()), flags); err != nil {
		file.Close()
		return nil, fmt.Errorf("acquire operation lock: %w", err)
	}
	return &File{file: file}, nil
}

func (value *File) Close() error {
	if value == nil || value.file == nil {
		return nil
	}
	_ = unix.Flock(int(value.file.Fd()), unix.LOCK_UN)
	return value.file.Close()
}
