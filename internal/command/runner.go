package command

import (
	"context"
	"io"
)

type Result struct {
	Stdout   string
	Stderr   string
	ExitCode int
}

type Runner interface {
	Run(ctx context.Context, stdin io.Reader, name string, args ...string) (Result, error)
}
