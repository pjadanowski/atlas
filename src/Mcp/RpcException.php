<?php

namespace Pjadanowski\Atlas\Mcp;

use RuntimeException;

/** A JSON-RPC error to be returned to the client, with its protocol error code. */
class RpcException extends RuntimeException
{
    public function __construct(int $code, string $message)
    {
        parent::__construct($message, $code);
    }
}
