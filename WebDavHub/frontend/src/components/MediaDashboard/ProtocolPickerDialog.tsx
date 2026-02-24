import { Box, Button, Card, CardActionArea, Dialog, DialogActions, DialogContent, DialogTitle, Grid, Typography } from '@mui/material';
import { INDEXER_PROTOCOLS, IndexerProtocol } from '../../types/indexer';

interface ProtocolPickerDialogProps {
  open: boolean;
  onClose: () => void;
  onPick: (protocol: IndexerProtocol) => void;
}

export default function ProtocolPickerDialog({ open, onClose, onPick }: ProtocolPickerDialogProps) {

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Select Indexer Type</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2}>
          {INDEXER_PROTOCOLS.map(p => (
            <Grid size={{ xs: 12, sm: 6 }} key={p.value}>
              <Card variant="outlined" sx={{ borderRadius: 2 }}>
                <CardActionArea onClick={() => onPick(p.value)} sx={{ p: 2 }}>
                  <Box>
                    <Typography variant="subtitle1" fontWeight={600}>
                      {p.label}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {p.description}
                    </Typography>
                  </Box>
                </CardActionArea>
              </Card>
            </Grid>
          ))}
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}


